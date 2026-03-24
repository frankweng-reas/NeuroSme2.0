"""應用設定：專案名、API 路徑、資料庫 URL、CORS 來源"""
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict  # type: ignore[import-untyped]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)
    PROJECT_NAME: str = "NeuroSme API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"

    # Database
    DATABASE_URL: str = "postgresql://user:password@localhost:5432/neurosme"

    # DuckDB 長存：專案資料的 .duckdb 檔存放目錄（空則不啟用長存）
    DUCKDB_DATA_DIR: str = "data/duckdb"

    # Schema 檔案目錄（過渡；正式 schema 一律為 bi_schemas，見 schema_loader.load_schema_from_db）
    SCHEMA_CONFIG_DIR: str = ""

    # Chat 參考資料字元上限，超過則回傳 413 要求用戶縮小範圍
    CHAT_DATA_MAX_CHARS: int = 100_000

    # LLM API Keys (LiteLLM 支援 OpenAI / Gemini / 台智雲)
    OPENAI_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    TWCC_API_KEY: str = ""
    TWCC_API_BASE: str = ""  # 台智雲 Conversation API 完整 URL，例：https://api-ams.twcc.ai/api/models/conversation

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


settings = Settings()
