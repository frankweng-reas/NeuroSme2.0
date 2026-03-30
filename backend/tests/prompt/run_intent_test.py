#!/usr/bin/env python3
"""
Intent Prompt 回歸測試腳本

執行方式（從 backend/ 目錄）：
  ./venv/bin/python tests/prompt/run_intent_test.py --save-baseline   # 初次建立 baseline
  ./venv/bin/python tests/prompt/run_intent_test.py                   # 比對 baseline
  ./venv/bin/python tests/prompt/run_intent_test.py --ids A1 B1 F1   # 只跑特定題號
  ./venv/bin/python tests/prompt/run_intent_test.py --model gemini/gemini-2.0-flash
  ./venv/bin/python tests/prompt/run_intent_test.py --verbose         # 失敗時顯示 LLM 原始輸出
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import yaml

# ── 路徑設定：讓腳本從 tests/prompt/ 或 backend/ 都能執行 ──────────────────
_HERE = Path(__file__).resolve().parent
_BACKEND = _HERE.parent.parent          # backend/
_REPO = _BACKEND.parent                 # repo root
sys.path.insert(0, str(_BACKEND))

# 載入 .env（backend/.env）
from dotenv import load_dotenv
load_dotenv(_BACKEND / ".env")

# ── 現在才 import app 模組（需要 .env 先載入）─────────────────────────────
import litellm
from app.core.database import SessionLocal
from app.services.schema_loader import load_schema_from_db
from app.api.endpoints.chat_compute_tool import (
    _extract_json_from_llm,
    _normalize_question_for_intent_extraction,
    _build_schema_block,
    _build_hierarchy_block,
)
from app.schemas.intent_v4 import IntentV4, auto_repair_intent
from pydantic import ValidationError

CASES_FILE = _HERE / "cases.yaml"
BASELINE_DIR = _HERE / "baseline"
BASELINE_DIR.mkdir(parents=True, exist_ok=True)

# ANSI 顏色
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
RESET = "\033[0m"
BOLD = "\033[1m"


def load_cases() -> dict:
    with open(CASES_FILE, encoding="utf-8") as f:
        return yaml.safe_load(f)


def build_intent_prompt(schema_def: dict) -> str:
    """複用 chat_compute_tool 的 prompt 組裝邏輯。"""
    base = _REPO / "config" / "system_prompt_analysis_intent_tool.md"
    raw = base.read_text(encoding="utf-8").strip()
    schema_block = _build_schema_block(schema_def)
    hierarchy_block = _build_hierarchy_block(schema_def)
    schema_name = schema_def.get("name") or "Sales Analytics"
    return (
        raw
        .replace("{{SCHEMA_NAME}}", schema_name)
        .replace("{{SCHEMA_DEFINITION}}", schema_block)
        .replace("{{DIMENSION_HIERARCHY}}", hierarchy_block)
    )


def call_llm(model: str, system_prompt: str, user_content: str) -> str:
    resp = litellm.completion(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        temperature=0,
    )
    return resp.choices[0].message.content or ""


def validate_intent(raw_output: str) -> tuple[dict | None, str | None]:
    """
    回傳 (intent_dict, error_message)。
    intent_dict 為通過 Pydantic 驗證後的 dict；失敗時為 None。
    """
    intent = _extract_json_from_llm(raw_output)
    if not intent:
        return None, "無法從 LLM 輸出萃取 JSON"
    intent = auto_repair_intent(intent)
    try:
        IntentV4.model_validate(intent)
        return intent, None
    except ValidationError as e:
        first_err = e.errors()[0]
        loc = " → ".join(str(x) for x in first_err.get("loc", []))
        msg = first_err.get("msg", "")
        return None, f"{loc}：{msg}" if loc else msg


def load_baseline(case_id: str) -> dict | None:
    path = BASELINE_DIR / f"{case_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_baseline(case_id: str, intent: dict) -> None:
    path = BASELINE_DIR / f"{case_id}.json"
    path.write_text(json.dumps(intent, ensure_ascii=False, indent=2), encoding="utf-8")


def diff_summary(old: dict, new: dict) -> list[str]:
    """簡單的一層 key diff，回傳有差異的說明。"""
    diffs = []
    all_keys = set(old) | set(new)
    for k in sorted(all_keys):
        ov, nv = old.get(k), new.get(k)
        if ov != nv:
            diffs.append(f"  [{k}] {ov!r} → {nv!r}")
    return diffs


def run(
    save_baseline_mode: bool = False,
    filter_ids: list[str] | None = None,
    model_override: str | None = None,
    verbose: bool = False,
) -> None:
    config = load_cases()
    schema_id = config["schema_id"]
    model = model_override or config.get("model", "gpt-4o-mini")
    cases = config["cases"]

    if filter_ids:
        cases = [c for c in cases if c["id"] in filter_ids]
        if not cases:
            print(f"找不到指定 ids：{filter_ids}")
            sys.exit(1)

    print(f"\n{BOLD}Intent Prompt 回歸測試{RESET}")
    print(f"schema_id : {schema_id}")
    print(f"model     : {model}")
    print(f"模式      : {'【儲存 baseline】' if save_baseline_mode else '【比對 baseline】'}")
    print(f"題數      : {len(cases)}")
    print(f"時間      : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("─" * 60)

    db = SessionLocal()
    try:
        schema_def = load_schema_from_db(schema_id, db)
    finally:
        db.close()

    if not schema_def:
        print(f"{RED}無法載入 schema（id={schema_id}），請確認 DB 連線與 schema_id。{RESET}")
        sys.exit(1)

    intent_prompt = build_intent_prompt(schema_def)
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

    results = {"pass": [], "warn": [], "fail": [], "new": []}

    for case in cases:
        cid = case["id"]
        label = case["label"]
        question = case["question"]
        user_content = f"當前時間：{now_str}\n\n問題: {_normalize_question_for_intent_extraction(question)}"

        sys.stdout.write(f"  {cid} {label} ... ")
        sys.stdout.flush()

        try:
            raw = call_llm(model, intent_prompt, user_content)
        except Exception as e:
            print(f"{RED}❌ LLM 呼叫失敗：{e}{RESET}")
            results["fail"].append((cid, label, f"LLM 呼叫失敗：{e}"))
            continue

        intent, err = validate_intent(raw)

        if err:
            print(f"{RED}❌ 驗證失敗{RESET}")
            print(f"     原因：{err}")
            if verbose:
                print(f"     LLM 輸出：{raw[:300]}")
            results["fail"].append((cid, label, err))
            continue

        if save_baseline_mode:
            save_baseline(cid, intent)
            print(f"{GREEN}✅ 已儲存 baseline{RESET}")
            results["new"].append((cid, label))
            continue

        baseline = load_baseline(cid)
        if baseline is None:
            print(f"{YELLOW}⚠️  無 baseline（請先執行 --save-baseline）{RESET}")
            results["warn"].append((cid, label, "無 baseline"))
            continue

        diffs = diff_summary(baseline, intent)
        if not diffs:
            print(f"{GREEN}✅ 通過{RESET}")
            results["pass"].append((cid, label))
        else:
            print(f"{YELLOW}⚠️  輸出有變動{RESET}")
            for d in diffs:
                print(d)
            results["warn"].append((cid, label, f"{len(diffs)} 個欄位變動"))

    # ── 報告 ────────────────────────────────────────────────────────────────
    total = len(cases)
    print("\n" + "─" * 60)
    print(f"{BOLD}測試結果{RESET}")
    print(f"  ✅ 通過      : {len(results['pass'])}")
    print(f"  ⚠️  有變動    : {len(results['warn'])}")
    print(f"  ❌ 驗證失敗  : {len(results['fail'])}")
    if save_baseline_mode:
        print(f"  💾 儲存 baseline : {len(results['new'])}")
    print(f"  總計        : {total}")

    if results["fail"]:
        print(f"\n{RED}驗證失敗題目：{RESET}")
        for cid, label, reason in results["fail"]:
            print(f"  {cid} {label}：{reason}")

    if results["warn"] and not save_baseline_mode:
        print(f"\n{YELLOW}有變動題目（請人工確認是改善還是退步）：{RESET}")
        for cid, label, reason in results["warn"]:
            print(f"  {cid} {label}：{reason}")

    print()
    if results["fail"]:
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Intent Prompt 回歸測試")
    parser.add_argument(
        "--save-baseline",
        action="store_true",
        help="儲存目前 LLM 輸出為 baseline（prompt 穩定時執行）",
    )
    parser.add_argument(
        "--ids",
        nargs="+",
        metavar="ID",
        help="只跑指定題號，如 A1 B1 F1",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="覆寫 model，如 gemini/gemini-2.0-flash",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="失敗時顯示 LLM 原始輸出",
    )
    args = parser.parse_args()
    run(
        save_baseline_mode=args.save_baseline,
        filter_ids=args.ids,
        model_override=args.model,
        verbose=args.verbose,
    )
