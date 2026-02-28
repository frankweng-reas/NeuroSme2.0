"""Chat API：POST /chat/completions 呼叫 OpenAI Chat Completions"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import OpenAI

from app.core.config import settings

router = APIRouter()


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    system_prompt: str = ""
    user_prompt: str = ""
    data: str = ""  # Data 區塊內容，作為參考資料併入 system
    model: str = "gpt-4o-mini"
    messages: list[ChatMessage] = []
    content: str  # 新使用者訊息


class UsageMeta(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatResponse(BaseModel):
    content: str
    model: str = ""
    usage: UsageMeta | None = None
    finish_reason: str | None = None


def _build_messages(req: ChatRequest) -> list[dict]:
    """組裝 OpenAI messages 格式"""
    msgs: list[dict] = []
    system_parts: list[str] = []
    if req.system_prompt.strip():
        system_parts.append(req.system_prompt.strip())
    if req.data.strip():
        system_parts.append(f"以下為參考資料：\n\n{req.data.strip()}")
    if system_parts:
        msgs.append({"role": "system", "content": "\n\n".join(system_parts)})
    for m in req.messages:
        msgs.append({"role": m.role, "content": m.content})
    # 新訊息：若有 user_prompt 則前置
    user_content = req.content
    if req.user_prompt.strip():
        user_content = f"{req.user_prompt.strip()}\n\n{req.content}"
    msgs.append({"role": "user", "content": user_content})
    return msgs


@router.post("/completions", response_model=ChatResponse)
def chat_completions(req: ChatRequest):
    if not settings.OPENAI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY 未設定，請在 .env 中設定",
        )
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    messages = _build_messages(req)
    try:
        model = req.model if req.model.strip() else "gpt-4o-mini"
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
        )
        choice = resp.choices[0]
        content = choice.message.content or ""
        usage = None
        if resp.usage:
            usage = UsageMeta(
                prompt_tokens=resp.usage.prompt_tokens,
                completion_tokens=resp.usage.completion_tokens,
                total_tokens=resp.usage.total_tokens,
            )
        return ChatResponse(
            content=content,
            model=resp.model or "",
            usage=usage,
            finish_reason=choice.finish_reason,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
