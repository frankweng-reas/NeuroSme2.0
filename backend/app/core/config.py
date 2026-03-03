"""應用設定：專案名、API 路徑、資料庫 URL、CORS 來源"""
from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    PROJECT_NAME: str = "NeuroSme API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"

    # Database
    DATABASE_URL: str = "postgresql://user:password@localhost:5432/neurosme"

    # Chat 參考資料字元上限，超過則回傳 413 要求用戶縮小範圍
    CHAT_DATA_MAX_CHARS: int = 100_000

    # LLM API Keys (LiteLLM 支援 OpenAI / Gemini / 台智雲)
    OPENAI_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    TWCC_API_KEY: str = ""
    TWCC_API_BASE: str = ""  # 台智雲端點，例：https://xxx.twcc.ai/v1

    # JWT（與 LocalAuth 共用 secret）
    JWT_SECRET: str = "change-me-in-production"

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3002",
    ]

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
