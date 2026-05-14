"""外部資料來源連接器套件"""
from app.connectors.base import BaseConnector, ConnectorDocument
from app.connectors.slack import SlackConnector

CONNECTOR_REGISTRY: dict[str, type[BaseConnector]] = {
    "slack": SlackConnector,
}

__all__ = ["BaseConnector", "ConnectorDocument", "SlackConnector", "CONNECTOR_REGISTRY"]
