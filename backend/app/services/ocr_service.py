"""OCR 抽取服務：將圖片傳給 vision LLM，回傳結構化欄位"""
import base64
import json
import logging
import re
from pathlib import Path
from typing import Any

import litellm
from sqlalchemy.orm import Session

from app.services.llm_caller import LLMCallError, LLMProviderNotConfigured, build_llm_kwargs

logger = logging.getLogger(__name__)

_CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"
_OCR_SYSTEM_PROMPT_FILE = "system_prompt_ocr_agent.md"


def _load_ocr_system_prompt() -> str:
    """從 config/system_prompt_ocr_agent.md 讀取，改檔即生效"""
    path = _CONFIG_DIR / _OCR_SYSTEM_PROMPT_FILE
    try:
        return path.read_text(encoding="utf-8").strip()
    except (OSError, IOError) as e:
        logger.warning("OCR system prompt 載入失敗: %s", e)
        return "你是一個文件資料抽取助手，請從圖片中抽取指定欄位並以純 JSON 回傳。"

# ── 預設範本 ────────────────────────────────────────────────────────────────────

BUILTIN_TEMPLATES: list[dict] = [
    {
        "id": "invoice",
        "label": "發票",
        "data_type_label": "發票",
        "fields": [
            {"name": "invoice_date", "hint": "發票日期（YYYY-MM-DD）"},
            {"name": "invoice_number", "hint": "發票號碼"},
            {"name": "seller", "hint": "賣方名稱"},
            {"name": "buyer", "hint": "買方名稱"},
            {"name": "subtotal", "hint": "稅前金額（數字，不含貨幣符號）"},
            {"name": "tax", "hint": "稅額（數字，不含貨幣符號）"},
            {"name": "total", "hint": "含稅總金額（數字，不含貨幣符號）"},
            {"name": "items", "hint": "品項列表（逗號分隔）"},
        ],
    },
    {
        "id": "business_card",
        "label": "名片",
        "data_type_label": "名片",
        "fields": [
            {"name": "name", "hint": "姓名"},
            {"name": "title", "hint": "職稱"},
            {"name": "company", "hint": "公司名稱"},
            {"name": "phone", "hint": "電話號碼"},
            {"name": "email", "hint": "電子郵件"},
            {"name": "address", "hint": "地址"},
        ],
    },
    {
        "id": "receipt",
        "label": "收據",
        "data_type_label": "收據",
        "fields": [
            {"name": "date", "hint": "日期（YYYY-MM-DD）"},
            {"name": "store", "hint": "商店名稱"},
            {"name": "total", "hint": "總金額（數字）"},
            {"name": "items", "hint": "品項列表（逗號分隔）"},
            {"name": "payment_method", "hint": "付款方式"},
        ],
    },
    {
        "id": "handwritten",
        "label": "手寫文件",
        "data_type_label": "手寫文件",
        "fields": [
            {"name": "date", "hint": "文件日期"},
            {"name": "author", "hint": "作者/署名"},
            {"name": "content", "hint": "完整文字內容"},
            {"name": "subject", "hint": "主題/標題"},
        ],
    },
]


# ── Image → base64 ──────────────────────────────────────────────────────────

def _file_to_images(file_bytes: bytes, content_type: str) -> list[tuple[str, str]]:
    """回傳 [(mime_type, base64_data)]，直接 base64 不做任何縮放或轉換"""
    ct = content_type.lower()
    mime = ct if ct.startswith("image/") else "image/jpeg"
    b64 = base64.standard_b64encode(file_bytes).decode("ascii")
    return [(mime, b64)]


# ── Prompt builder ────────────────────────────────────────────────────────────

def _build_user_context(data_type_label: str, output_fields: list[dict]) -> str:
    """組合動態的提示內容，放在 user message 中"""
    parts = []
    if data_type_label:
        parts.append(f"文件類型：{data_type_label}")
    parts.append("請萃取圖片中的所有文字。")
    if output_fields:
        field_names = [f['name'] for f in output_fields]
        hint_lines = "\n".join(
            f'  "{f["name"]}": "{f["hint"]}"' if f.get("hint") else f'  "{f["name"]}": ""'
            for f in output_fields
        )
        parts.append(
            f"\n【強制要求】完成文字萃取後，你的回覆最後一定要包含以下 JSON code block，"
            f"不得省略，不得加其他說明文字：\n"
            f"```json\n"
            f"{{\n{hint_lines}\n}}\n"
            f"```\n"
            f"欄位說明（hint 只是提示，實際請從圖片中取值）：\n"
            + "\n".join(f'- {f["name"]}: {f["hint"]}' for f in output_fields if f.get("hint"))
            + "\n若某欄位在圖片中找不到，值設為 null。"
        )
    return "\n".join(parts)


_CODE_BLOCK_RE = re.compile(
    r"```(?:json)?\s*(.*?)\s*```",
    re.DOTALL | re.IGNORECASE,
)


def _try_parse_json(s: str) -> dict | list | None:
    """嘗試解析 JSON，失敗時清除控制字元後再試一次"""
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    try:
        clean = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', s)
        return json.loads(clean)
    except Exception:
        return None


def _parse_llm_response(text: str, output_fields: list[dict]) -> tuple[str, dict]:
    """
    從 LLM 回覆中分離：
    - raw_text: JSON block 之前的文字（純文字辨識結果）
    - extracted_fields: 解析 JSON block 得到的欄位值
    若解析失敗，extracted_fields 回傳空 dict。
    """
    if not output_fields:
        return text, {}

    field_names = {f['name'] for f in output_fields}

    # 找出所有 code block，從最後往前找（指定欄位 JSON 應在回覆末尾）
    matches = list(_CODE_BLOCK_RE.finditer(text))
    if not matches:
        logger.info("ocr: no code block found in LLM response (first 200 chars): %r", text[:200])
        return text, {}

    for m in reversed(matches):
        block = m.group(1).strip()
        if not block.startswith('{'):
            continue

        parsed = _try_parse_json(block)
        if not isinstance(parsed, dict):
            continue

        # 確認此 block 確實含有我們期望的欄位
        if not any(k in field_names for k in parsed):
            continue

        raw_part = text[:m.start()].rstrip()
        extracted = {}
        for k, v in parsed.items():
            if k not in field_names:
                continue
            if v is None:
                extracted[k] = None
            elif isinstance(v, (dict, list)):
                # 巢狀結構序列化成 JSON 字串
                extracted[k] = json.dumps(v, ensure_ascii=False)
            else:
                extracted[k] = str(v)

        logger.info("ocr: parsed fields OK: %s", list(extracted.keys()))
        return raw_part, extracted

    logger.info("ocr: no valid fields JSON block found among %d code block(s)", len(matches))
    return text, {}



# ── Main extraction ───────────────────────────────────────────────────────────

async def extract_fields(
    file_bytes: bytes,
    content_type: str,
    model: str,
    data_type_label: str,
    output_fields: list[dict],
    db: Session,
    tenant_id: str,
) -> dict[str, Any]:
    """
    回傳：{
        raw_text: str,          # LLM 原始回覆
        extracted_fields: dict, # 解析後的結構化欄位
    }
    """
    if not output_fields:
        raise ValueError("至少需要定義一個輸出欄位")

    images = _file_to_images(file_bytes, content_type)
    if not images:
        raise ValueError("無法解析檔案內容")

    system_prompt = _load_ocr_system_prompt()
    user_context = _build_user_context(data_type_label, output_fields)

    # messages：system prompt + 圖片 + 欄位說明
    content: list[dict] = []
    for mime, b64 in images:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}"},
        })
    content.append({"type": "text", "text": user_context})

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": content},
    ]

    try:
        kwargs = build_llm_kwargs(
            model=model,
            messages=messages,
            db=db,
            tenant_id=tenant_id,
            stream=False,
            temperature=0,
            timeout=180,
        )
    except LLMProviderNotConfigured:
        raise ValueError(f"模型 {model} 的 API Key 未設定，請先在 Provider 設定中新增")

    logger.info("ocr extract: model=%s pages=%d fields=%d", model, len(images), len(output_fields))

    try:
        resp = await litellm.acompletion(**kwargs)
    except Exception as exc:
        raise LLMCallError(f"OCR LLM 呼叫失敗：{exc}", cause=exc) from exc
    full_text = (resp.choices[0].message.content or "").strip()

    raw_text, extracted_fields = _parse_llm_response(full_text, output_fields)

    # 若欄位為空（model 沒有產生 JSON block），自動重試一次
    if output_fields and not extracted_fields:
        logger.warning("ocr: extracted_fields empty, retrying once...")
        try:
            resp = await litellm.acompletion(**kwargs)
        except Exception as exc:
            raise LLMCallError(f"OCR LLM 重試失敗：{exc}", cause=exc) from exc
        full_text = (resp.choices[0].message.content or "").strip()
        raw_text, extracted_fields = _parse_llm_response(full_text, output_fields)
        if extracted_fields:
            logger.info("ocr: retry succeeded")
        else:
            logger.warning("ocr: retry also produced no fields")

    usage: dict | None = None
    if hasattr(resp, "usage") and resp.usage is not None:
        u = resp.usage
        usage = {
            "prompt_tokens": getattr(u, "prompt_tokens", 0) or 0,
            "completion_tokens": getattr(u, "completion_tokens", 0) or 0,
            "total_tokens": getattr(u, "total_tokens", 0) or 0,
        }

    return {"raw_text": raw_text, "extracted_fields": extracted_fields, "usage": usage}
