#!/usr/bin/env python3
"""
ollama_vision_warmup.py
-----------------------
每次重啟 ollama / ollama2 後執行一次，
分別對兩個實例發文字請求，確保模型載入 VRAM。

用法：
    python3 scripts/ollama_vision_warmup.py
    # 或指定主機：
    python3 scripts/ollama_vision_warmup.py 100.127.247.43
"""

import json, sys, threading, time, urllib.request

HOST = sys.argv[1] if len(sys.argv) > 1 else "100.127.247.43"
PORTS = [11435, 11436, 11437]
MODEL = "gemma4:26b"
TIMEOUT = 120


def warmup(port: int, results: dict) -> None:
    label = f":{port}"
    payload = json.dumps({
        "model": MODEL,
        "think": False,
        "stream": False,
        "messages": [{"role": "user", "content": "Hi"}],
        "options": {"num_predict": 5},
    }).encode()
    req = urllib.request.Request(
        f"http://{HOST}:{port}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            d = json.load(resp)
        elapsed = time.perf_counter() - t0
        text = d.get("message", {}).get("content", "").strip()
        results[port] = {"ok": True, "elapsed": elapsed, "text": text}
        print(f"  [{label}] ✅ {elapsed:.1f}s  →  {text[:40]}", flush=True)
    except Exception as e:
        elapsed = time.perf_counter() - t0
        results[port] = {"ok": False, "elapsed": elapsed, "error": str(e)}
        print(f"  [{label}] ❌ {elapsed:.1f}s  →  {e}", flush=True)


def main() -> None:
    print(f"Warming up {MODEL} on {HOST} (ports {PORTS})...")
    results: dict = {}
    threads = [threading.Thread(target=warmup, args=(p, results)) for p in PORTS]
    t0 = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    total = time.perf_counter() - t0

    ok = all(results.get(p, {}).get("ok") for p in PORTS)
    status = "✅ All instances ready" if ok else "❌ Some instances FAILED"
    print(f"\n{status}  ({total:.1f}s total)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
