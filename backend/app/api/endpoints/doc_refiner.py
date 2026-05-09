"""文件整理 Agent API

POST /doc-refiner/process   - 上傳 PDF，LLM 整理成 Q&A 或摘要，回傳 JSON
POST /doc-refiner/export    - 接收整理後的 JSON，產生 PDF 下載
"""
import io
import json
import logging
import re
from pathlib import Path
from typing import Annotated, Any

import pdfplumber
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.chat_service import _load_system_prompt_from_file
from app.services.llm_caller import LLMCallError, LLMProviderNotConfigured, call_llm

router = APIRouter()
logger = logging.getLogger(__name__)

_FONT_PATH = Path(__file__).resolve().parents[4] / "config" / "fonts" / "NotoSansTC-Regular.ttf"
_MAX_PDF_BYTES = 20 * 1024 * 1024  # 20 MB
_MAX_TEXT_CHARS = 30_000           # 避免 context 過長


# ──────────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────────

class QAItem(BaseModel):
    id: int
    question: str
    answer: str


class SummaryItem(BaseModel):
    id: int
    heading: str = ""
    content: str


class ProcessResponse(BaseModel):
    mode: str                          # 'qa' | 'summary'
    title: str
    items: list[dict[str, Any]]
    page_count: int
    char_count: int


class ExportRequest(BaseModel):
    mode: str
    title: str
    items: list[dict[str, Any]]


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _extract_text(pdf_bytes: bytes) -> tuple[str, int]:
    """從 PDF 萃取純文字，回傳 (text, page_count)"""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        pages = pdf.pages
        page_count = len(pages)
        parts: list[str] = []
        for i, page in enumerate(pages):
            text = (page.extract_text() or "").strip()
            if text:
                parts.append(f"[第 {i + 1} 頁]\n{text}")
    return "\n\n".join(parts), page_count


def _parse_llm_json(raw: str) -> dict:
    """從 LLM 回覆中萃取 JSON，容忍 markdown code fence"""
    # 去掉 ```json ... ``` 包裝
    cleaned = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()
    # 找第一個 { 到最後一個 }
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("LLM 回覆中找不到合法 JSON")
    return json.loads(cleaned[start:end + 1])


def _generate_pdf(mode: str, title: str, items: list[dict]) -> bytes:
    """用 fpdf2 產生中文 PDF，回傳 bytes"""
    from fpdf import FPDF, XPos, YPos

    pdf = FPDF()
    pdf.set_margins(20, 20, 20)
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # 中文字型
    if _FONT_PATH.exists():
        pdf.add_font("NotoSansTC", "", str(_FONT_PATH))
        font = "NotoSansTC"
    else:
        font = "Helvetica"
        logger.warning("中文字型未找到，退回 Helvetica")

    # 標題
    pdf.set_font(font, size=18)
    pdf.cell(0, 12, title or "整理文件", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(4)

    # 模式標籤
    mode_label = "Q&A 格式" if mode == "qa" else "摘要格式"
    pdf.set_font(font, size=10)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 6, mode_label, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_text_color(0, 0, 0)
    pdf.ln(6)

    # 分隔線
    pdf.set_draw_color(200, 200, 200)
    pdf.line(20, pdf.get_y(), 190, pdf.get_y())
    pdf.ln(6)

    if mode == "qa":
        for item in items:
            idx = item.get("id", "")
            q = item.get("question", "")
            a = item.get("answer", "")

            # 問題
            pdf.set_font(font, size=12)
            pdf.set_fill_color(240, 248, 255)
            pdf.set_text_color(30, 64, 175)
            pdf.multi_cell(0, 7, f"Q{idx}. {q}", fill=True,
                           new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.ln(1)

            # 答案
            pdf.set_font(font, size=11)
            pdf.set_fill_color(255, 255, 255)
            pdf.set_text_color(30, 30, 30)
            pdf.multi_cell(0, 7, f"A. {a}",
                           new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.ln(5)

    else:  # summary
        for item in items:
            heading = item.get("heading", "")
            content = item.get("content", "")

            if heading:
                pdf.set_font(font, size=13)
                pdf.set_text_color(15, 118, 110)
                pdf.cell(0, 8, heading, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.ln(1)

            pdf.set_font(font, size=11)
            pdf.set_text_color(30, 30, 30)
            pdf.multi_cell(0, 7, content, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.ln(5)

    return bytes(pdf.output())


# ──────────────────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/process", response_model=ProcessResponse, summary="整理文件")
async def process_document(
    file: UploadFile = File(..., description="原始 PDF 檔案"),
    mode: str = Form("qa", description="整理模式：qa | summary"),
    model: str = Form("", description="指定 LLM model（留空使用租戶預設）"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """上傳 PDF，LLM 整理成 Q&A 或摘要 JSON。"""
    if mode not in ("qa", "summary"):
        raise HTTPException(status_code=422, detail="mode 必須為 qa 或 summary")

    pdf_bytes = await file.read()
    if len(pdf_bytes) == 0:
        raise HTTPException(status_code=400, detail="上傳的檔案是空的")
    if len(pdf_bytes) > _MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="檔案過大（上限 20 MB）")

    # 萃取文字
    try:
        raw_text, page_count = _extract_text(pdf_bytes)
    except Exception as exc:
        logger.error("PDF 文字萃取失敗: %s", exc)
        raise HTTPException(status_code=400, detail=f"PDF 解析失敗，請確認檔案完整性：{exc}") from exc

    if not raw_text.strip():
        raise HTTPException(status_code=400, detail="無法從 PDF 萃取文字（可能是純圖片 PDF，請先跑 OCR）")

    # 截斷過長文字
    char_count = len(raw_text)
    if char_count > _MAX_TEXT_CHARS:
        raw_text = raw_text[:_MAX_TEXT_CHARS] + "\n\n[文件過長，已截取前段內容]"

    # 組裝提示
    mode_hint = "Q&A" if mode == "qa" else "摘要"
    filename = (file.filename or "文件").rsplit(".", 1)[0]
    system_prompt = _load_system_prompt_from_file("doc_refiner") or ""

    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                f"請將以下文件整理成「{mode_hint}」格式。\n"
                f"文件名稱：{filename}\n\n"
                f"--- 文件內容開始 ---\n{raw_text}\n--- 文件內容結束 ---"
            ),
        },
    ]

    # 決定 model（前端指定 > 租戶預設）
    use_model = model.strip()
    if not use_model:
        # 嘗試從租戶預設 LLM config 取
        from app.services.llm_service import _get_llm_params
        from app.models.llm_provider_config import LLMProviderConfig
        cfg = (
            db.query(LLMProviderConfig)
            .filter(
                LLMProviderConfig.tenant_id == current.tenant_id,
                LLMProviderConfig.is_active.is_(True),
            )
            .order_by(LLMProviderConfig.id)
            .first()
        )
        if cfg:
            provider = cfg.provider
            if provider == "gemini":
                use_model = "gemini/gemini-2.0-flash"
            elif provider == "local":
                use_model = "local/gemma4:26b"
            else:
                use_model = "gpt-4o-mini"
        else:
            raise HTTPException(status_code=400, detail="請指定 model 參數，或在 AI 設定中設定 LLM Provider")

    # 呼叫 LLM
    try:
        answer, _usage, _latency = await call_llm(
            model=use_model,
            messages=messages,
            db=db,
            tenant_id=current.tenant_id,
            temperature=0.3,
        )
    except LLMProviderNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LLMCallError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # 解析 JSON
    try:
        result = _parse_llm_json(answer)
    except (ValueError, json.JSONDecodeError) as exc:
        logger.error("LLM 回覆 JSON 解析失敗: %s\nRaw: %s", exc, answer[:500])
        raise HTTPException(
            status_code=502,
            detail="LLM 回覆格式有誤，請重試或換用其他模型",
        ) from exc

    return ProcessResponse(
        mode=result.get("mode", mode),
        title=result.get("title", filename),
        items=result.get("items", []),
        page_count=page_count,
        char_count=char_count,
    )


@router.post("/export", summary="匯出整理後 PDF")
async def export_pdf(
    body: ExportRequest,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """接收整理後的 JSON，產生 PDF 並以串流回傳。"""
    if not body.items:
        raise HTTPException(status_code=400, detail="沒有可匯出的內容")

    try:
        pdf_bytes = _generate_pdf(body.mode, body.title, body.items)
    except Exception as exc:
        logger.error("PDF 生成失敗: %s", exc)
        raise HTTPException(status_code=500, detail=f"PDF 生成失敗：{exc}") from exc

    safe_title = re.sub(r'[^\w\u4e00-\u9fff\-]', '_', body.title)[:40] or "document"
    filename = f"{safe_title}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
