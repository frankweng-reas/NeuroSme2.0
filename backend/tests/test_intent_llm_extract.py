"""意圖萃取：使用者問句正規化與 LLM 回覆 JSON 截取。"""
import json

import pytest
from pydantic import ValidationError

from app.api.endpoints.chat_compute_tool import (
    _extract_json_from_llm,
    _normalize_question_for_intent_extraction,
    _pydantic_errors_json_safe,
)
from app.schemas.intent_v2 import IntentV2


def test_normalize_question_strips_cjk_book_brackets():
    assert _normalize_question_for_intent_extraction("『鮮乳坊』品牌通路") == "鮮乳坊品牌通路"
    assert _normalize_question_for_intent_extraction("「測試」") == "測試"


def test_extract_json_from_llm_uses_raw_decode_respects_brace_in_string():
    """舊版僅數大括號會在遇到字串內 `}` 時截錯；raw_decode 應正確。"""
    raw = '說明如下 {"filters": [{"column": "col_4", "value": "a}b"}], "version": 2}'
    d = _extract_json_from_llm(raw)
    assert d is not None
    assert d.get("version") == 2
    assert d["filters"][0]["value"] == "a}b"


def test_extract_json_from_llm_first_object_only():
    raw = '{"version": 2, "metrics": []} trailing garbage { "not": "parsed" }'
    d = _extract_json_from_llm(raw)
    assert d == {"version": 2, "metrics": []}


def test_pydantic_errors_json_safe_no_exception_objects_in_ctx():
    """model_validator 的 ValueError 會讓 e.errors() 的 ctx 含 Exception，json.dumps 會炸。"""
    bad = {
        "version": 2,
        "dimensions": {"group_by": []},
        "filters": [],
        "metrics": [
            {
                "id": "g",
                "kind": "grand_share",
                "column": "col_11",
                "as": "a",
                "numerator_filters": [{"column": "col_4", "op": "eq", "value": "x"}],
            },
            {"id": "m", "kind": "aggregate", "column": "col_11", "aggregation": "sum", "as": "b"},
        ],
    }
    with pytest.raises(ValidationError) as exc_info:
        IntentV2.model_validate(bad)
    safe = _pydantic_errors_json_safe(exc_info.value)
    json.dumps(safe)
    assert isinstance(safe, list) and safe[0].get("type") == "value_error"
