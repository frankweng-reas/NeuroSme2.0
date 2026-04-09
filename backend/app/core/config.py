"""應用設定：專案名、API 路徑、資料庫 URL、CORS 來源"""
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict  # type: ignore[import-untyped]


class Settings(BaseSettings):
    # extra：略過 .env 內未定義之鍵（如 docker 常用 POSTGRES_*），避免啟動／測試被擋
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")
    PROJECT_NAME: str = "NeuroSme API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"

    # Database
    DATABASE_URL: str = "postgresql://user:password@localhost:5432/neurosme"

    # DuckDB 長存：專案資料的 .duckdb 檔存放目錄（空則不啟用長存）
    DUCKDB_DATA_DIR: str = "data/duckdb"

    # 統一上傳檔（stored_files）：本機 blob 根目錄，相對於 backend/（實際為 backend/data/stored_files/...）
    STORED_FILES_DIR: str = "data/stored_files"

    @field_validator("STORED_FILES_DIR", mode="before")
    @classmethod
    def _stored_files_dir_non_empty(cls, v: object) -> str:
        """.env 若寫 STORED_FILES_DIR= 空字串，改回預設，避免上傳永遠 503。"""
        if v is None:
            return "data/stored_files"
        if isinstance(v, str) and not v.strip():
            return "data/stored_files"
        return str(v)

    # 為 True 時，計算失敗（含「查無資料」）在使用者可見的 content 末段附加後端錯誤與 SQL，利於除錯；正式環境建議 False
    EXPOSE_COMPUTE_ERROR_DETAIL: bool = False

    # Schema 檔案目錄（過渡；正式 schema 一律為 bi_schemas，見 schema_loader.load_schema_from_db）
    SCHEMA_CONFIG_DIR: str = ""

    # Chat 參考資料字元上限（BI／一般附檔來源），超過則回傳 413
    CHAT_DATA_MAX_CHARS: int = 100_000
    # Chat Agent 附件注入上限：配合本機約 32K context，保留系統／歷史／輸出空間
    CHAT_AGENT_REFERENCE_MAX_CHARS: int = 24_000
    # PDF 擷取：單檔最多頁數與擷取字元上限（仍受 CHAT_AGENT_REFERENCE_MAX_CHARS 合併限制）
    CHAT_PDF_MAX_PAGES: int = 48
    CHAT_PDF_EXTRACT_MAX_CHARS_PER_FILE: int = 20_000
    # Chat 圖片附件：實體存 stored_files（chat_message_attachments），送 LLM 時自 blob 讀出組多模態。
    # MAX_BYTES：上傳驗證（persist_chat_uploads）與圖檔類單檔上限；MAX_COUNT：單次 completion 最多注入幾張圖。
    CHAT_INLINE_IMAGE_MAX_BYTES: int = 4 * 1024 * 1024
    CHAT_INLINE_IMAGE_MAX_COUNT: int = 4

    # LLM Key 加密用對稱金鑰（Fernet，32-byte URL-safe base64）
    # 產生方式：python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    LLM_ENCRYPTION_KEY: str = ""

    # JWT（與 LocalAuth 共用 secret）
    JWT_SECRET: str = "change-me-in-production"

    # LocalAuth Admin API（後端代理用，勿暴露給前端）
    # 僅 on-prem / REGISTRATION_DISABLED 場景需設定；SaaS 自助註冊可留空
    LOCALAUTH_ADMIN_URL: str = "http://localhost:4000"
    LOCALAUTH_ADMIN_API_KEY: str = ""

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
