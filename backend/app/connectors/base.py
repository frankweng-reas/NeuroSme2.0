"""BaseConnector：所有外部資料來源連接器的抽象介面"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class ConnectorDocument:
    """連接器產出的單一文件單元，對應到一個 KmDocument。"""

    # 用於去重：同一 connector 下唯一識別此文件（例如 Slack channel + date range）
    source_id: str

    # 上傳時的檔案名稱
    filename: str

    # 純文字或 Markdown 內容（UTF-8）
    content: str

    # KmDocument.doc_type（article | faq | spec | policy）
    doc_type: str = "article"

    # 傳給 KmDocument.tags（可選）
    tags: list[str] = field(default_factory=list)


class BaseConnector(ABC):
    """
    所有 Connector 必須實作此介面。

    子類別只需關注「如何取得資料並轉成文字」，
    寫入 KB、embedding、去重等邏輯由 connector_service 統一處理。
    """

    @property
    @abstractmethod
    def source_type(self) -> str:
        """回傳此 Connector 的 source_type 字串，例如 'slack'"""

    @abstractmethod
    def validate_credentials(self, credentials: dict) -> None:
        """
        驗證 credentials 格式與必要欄位。
        不合法時拋出 ValueError。
        """

    @abstractmethod
    def fetch(
        self,
        config: dict,
        credentials: dict,
        last_cursor: str | None,
    ) -> tuple[list[ConnectorDocument], str | None]:
        """
        從外部來源拉取資料。

        Args:
            config:       connector 的靜態設定（channel_ids、days_lookback 等）
            credentials:  解密後的認證資訊（token 等）
            last_cursor:  上次同步的游標，None 表示全量同步

        Returns:
            (documents, new_cursor)
            - documents:   本次同步產出的文件列表
            - new_cursor:  新游標，下次增量同步的起點；None 表示不更新游標
        """
