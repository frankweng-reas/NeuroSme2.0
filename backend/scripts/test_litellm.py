#!/usr/bin/env python3
"""測試 LiteLLM 是否能正常呼叫 OpenAI。執行：python -m scripts.test_litellm"""
import os
import sys

# 載入 .env
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(backend_dir, ".env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ[k.strip()] = v.strip().strip('"').strip("'")

api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    print("請在 .env 設定 OPENAI_API_KEY")
    sys.exit(1)

import litellm

print("呼叫 litellm.completion(model='gpt-4o-mini', ...)")
resp = litellm.completion(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "你是誰"}],
    api_key=api_key,
    timeout=30,
)
print("成功:", resp.choices[0].message.content[:100] if resp.choices else "無回應")
