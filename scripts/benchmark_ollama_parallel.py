#!/usr/bin/env python3
"""
Ollama NUM_PARALLEL 壓測腳本（純標準庫版）
用途：測量不同 NUM_PARALLEL 設定下的並行推理吞吐量與延遲

使用方式：
  python3 benchmark_ollama_parallel.py --host http://100.127.247.43:11434 --concurrency 4
"""

import argparse
import json
import threading
import time
import urllib.request
from dataclasses import dataclass
from typing import Optional

PROMPT = (
    "請用繁體中文，簡單介紹 AMD Radeon 8060S GPU 的架構特點，大約 100 字。"
)


@dataclass
class RequestResult:
    worker_id: int
    success: bool
    ttft: Optional[float] = None
    total_time: Optional[float] = None
    tokens_generated: int = 0
    tps: Optional[float] = None
    error: Optional[str] = None


def single_request(host: str, model: str, worker_id: int) -> RequestResult:
    url = f"{host}/api/chat"
    payload = json.dumps({
        "model": model,
        "think": False,
        "stream": True,
        "messages": [{"role": "user", "content": PROMPT}],
        "options": {"temperature": 0.1},
    }).encode()

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    t_start = time.perf_counter()
    t_first_token = None
    tokens = 0
    result = RequestResult(worker_id=worker_id, success=False)

    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            for raw_line in resp:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue

                content = data.get("message", {}).get("content", "")
                if content and t_first_token is None:
                    t_first_token = time.perf_counter() - t_start

                if content:
                    tokens += 1

                if data.get("done"):
                    tokens = data.get("eval_count", tokens)
                    break

        t_end = time.perf_counter()
        total = t_end - t_start
        result.success = True
        result.ttft = t_first_token
        result.total_time = total
        result.tokens_generated = tokens
        result.tps = tokens / total if total > 0 else 0

    except Exception as e:
        result.error = str(e)

    return result


def run_round(host: str, model: str, concurrency: int, round_num: int, total_rounds: int) -> list:
    print(f"  Round {round_num}/{total_rounds}：同時發出 {concurrency} 個請求…", flush=True)
    results = [None] * concurrency

    def worker(i):
        results[i] = single_request(host, model, i)

    t0 = time.perf_counter()
    threads = [threading.Thread(target=worker, args=(i,)) for i in range(concurrency)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    elapsed = time.perf_counter() - t0

    success = sum(1 for r in results if r and r.success)
    total_toks = sum(r.tokens_generated for r in results if r and r.success)
    throughput = total_toks / elapsed if elapsed > 0 else 0
    print(f"    完成：{success}/{concurrency} 成功，{elapsed:.1f}s，合計 {total_toks} tokens，吞吐 {throughput:.1f} tok/s")
    return results


def print_summary(results: list, label: str):
    successes = [r for r in results if r and r.success]
    failures = [r for r in results if r and not r.success]

    print(f"\n{'='*58}")
    print(f"  結果摘要：{label}")
    print(f"{'='*58}")

    if not successes:
        print(f"  全部失敗！（{len(failures)} 筆）")
        for r in failures:
            print(f"    Worker {r.worker_id}: {r.error}")
        print(f"{'='*58}")
        return

    ttfts = [r.ttft for r in successes if r.ttft is not None]
    total_times = [r.total_time for r in successes]
    tpss = [r.tps for r in successes if r.tps]
    total_tokens = sum(r.tokens_generated for r in successes)

    print(f"  成功 / 總計       : {len(successes)} / {len(results)}")
    print(f"  總 tokens         : {total_tokens}")
    if ttfts:
        print(f"  TTFT（首個 token 延遲）")
        print(f"    平均            : {sum(ttfts)/len(ttfts):.2f}s")
        print(f"    最快            : {min(ttfts):.2f}s")
        print(f"    最慢            : {max(ttfts):.2f}s")
    if total_times:
        print(f"  總回應時間")
        print(f"    平均            : {sum(total_times)/len(total_times):.2f}s")
        print(f"    最慢            : {max(total_times):.2f}s")
    if tpss:
        print(f"  每請求 tok/s")
        print(f"    平均            : {sum(tpss)/len(tpss):.1f}")
        print(f"    最快            : {max(tpss):.1f}")
    if failures:
        print(f"  失敗請求：")
        for r in failures:
            print(f"    Worker {r.worker_id}: {r.error}")
    print(f"{'='*58}")


def main():
    parser = argparse.ArgumentParser(description="Ollama 並行推理壓測（純標準庫）")
    parser.add_argument("--host", default="http://100.127.247.43:11434")
    parser.add_argument("--model", default="gemma4:26b")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--rounds", type=int, default=2)
    parser.add_argument("--label", default="")
    args = parser.parse_args()

    label = args.label or f"concurrency={args.concurrency}"
    print(f"\n開始壓測：{label}")
    print(f"  Host    : {args.host}")
    print(f"  Model   : {args.model}")
    print(f"  並發數  : {args.concurrency}")
    print(f"  輪次    : {args.rounds}")
    print()

    all_results = []
    for r in range(1, args.rounds + 1):
        round_results = run_round(args.host, args.model, args.concurrency, r, args.rounds)
        all_results.extend(round_results)
        if r < args.rounds:
            time.sleep(2)

    print_summary(all_results, label)


if __name__ == "__main__":
    main()
