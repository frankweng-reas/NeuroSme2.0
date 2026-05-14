"""SlackConnector：從 Slack 頻道拉取訊息（含附件）並轉成 Markdown 文件"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

import httpx

from app.connectors.base import BaseConnector, ConnectorDocument
from app.services.km_service import extract_text

logger = logging.getLogger(__name__)

# Slack SDK 為選用依賴，未安裝時在 validate_credentials 拋出明確錯誤
try:
    from slack_sdk import WebClient
    from slack_sdk.errors import SlackApiError
    _SLACK_SDK_AVAILABLE = True
except ImportError:
    _SLACK_SDK_AVAILABLE = False


class SlackConnector(BaseConnector):
    """
    從指定的 Slack 頻道增量拉取訊息，轉成 Markdown 後進 KB。

    config 欄位：
        channel_ids (list[str]):  要同步的頻道 ID 列表（必填）
        days_lookback (int):      首次全量同步往回幾天（預設 30）
        doc_type (str):           產出的 KmDocument.doc_type（預設 "article"）
        include_threads (bool):   是否展開 thread 回覆（預設 true）

    credentials 欄位：
        token (str): Slack User Token（xoxp-...）或 Bot Token（xoxb-...）
    """

    @property
    def source_type(self) -> str:
        return "slack"

    def validate_credentials(self, credentials: dict) -> None:
        if not _SLACK_SDK_AVAILABLE:
            raise ValueError("slack_sdk 未安裝，請執行 pip install slack_sdk")
        if not credentials.get("token"):
            raise ValueError("credentials 必須包含 'token' 欄位")

    # ── 公開介面 ────────────────────────────────────────────────────────────

    def fetch(
        self,
        config: dict,
        credentials: dict,
        last_cursor: str | None,
    ) -> tuple[list[ConnectorDocument], str | None]:
        self.validate_credentials(credentials)

        channel_ids: list[str] = config.get("channel_ids", [])
        if not channel_ids:
            raise ValueError("config.channel_ids 不可為空")

        days_lookback: int = int(config.get("days_lookback", 30))
        doc_type: str = config.get("doc_type", "chat")
        include_threads: bool = config.get("include_threads", True)

        client = WebClient(token=credentials["token"])
        user_map = self._fetch_user_map(client)

        # 計算起始時間戳記
        if last_cursor:
            oldest_ts = last_cursor
        else:
            oldest = datetime.now(timezone.utc) - timedelta(days=days_lookback)
            oldest_ts = str(oldest.timestamp())

        documents: list[ConnectorDocument] = []
        new_cursor: str | None = None

        for channel_id in channel_ids:
            channel_name = self._fetch_channel_name(client, channel_id)
            messages, latest_ts = self._fetch_messages(client, channel_id, oldest_ts)

            if not messages:
                logger.info("Slack connector: #%s 無新訊息", channel_name)
                continue

            # 1. 頻道訊息文字 → Markdown 文件
            md_content = self._messages_to_markdown(
                messages=messages,
                channel_name=channel_name,
                channel_id=channel_id,
                user_map=user_map,
                client=client,
                include_threads=include_threads,
                oldest_ts=oldest_ts,
            )

            if md_content.strip():
                date_str = datetime.now().strftime("%Y%m%d")
                documents.append(ConnectorDocument(
                    source_id=f"slack:{channel_id}:{oldest_ts}",
                    filename=f"slack_{channel_name}_{date_str}.md",
                    content=md_content,
                    doc_type=doc_type,
                    tags=["slack", f"#{channel_name}"],
                ))

            # 2. 附件（PDF / Word / TXT）→ 各自獨立文件
            attachment_docs = self._fetch_attachments(
                messages=messages,
                channel_name=channel_name,
                token=credentials["token"],
                user_map=user_map,
            )
            documents.extend(attachment_docs)

            # 以所有頻道中最新的 ts 作為游標
            if latest_ts and (new_cursor is None or latest_ts > new_cursor):
                new_cursor = latest_ts

        return documents, new_cursor

    # ── 私有輔助方法 ─────────────────────────────────────────────────────────

    def _fetch_user_map(self, client: "WebClient") -> dict[str, str]:
        user_map: dict[str, str] = {}
        try:
            cursor = None
            while True:
                resp = client.users_list(limit=200, cursor=cursor)
                for member in resp["members"]:
                    uid = member["id"]
                    name = (
                        member.get("profile", {}).get("display_name")
                        or member.get("profile", {}).get("real_name")
                        or member.get("name")
                        or uid
                    )
                    user_map[uid] = name
                cursor = resp.get("response_metadata", {}).get("next_cursor")
                if not cursor:
                    break
        except Exception as e:
            logger.warning("無法取得 Slack 使用者列表：%s", e)
        return user_map

    def _fetch_channel_name(self, client: "WebClient", channel_id: str) -> str:
        try:
            resp = client.conversations_info(channel=channel_id)
            return resp["channel"].get("name", channel_id)
        except Exception:
            return channel_id

    def _fetch_messages(
        self,
        client: "WebClient",
        channel_id: str,
        oldest_ts: str,
    ) -> tuple[list[dict], str | None]:
        """拉取訊息，回傳 (messages, latest_ts)"""
        messages: list[dict] = []
        latest_ts: str | None = None
        try:
            cursor = None
            while True:
                resp = client.conversations_history(
                    channel=channel_id,
                    oldest=oldest_ts,
                    limit=200,
                    cursor=cursor,
                )
                batch = resp.get("messages", [])
                messages.extend(batch)
                cursor = resp.get("response_metadata", {}).get("next_cursor")
                if not cursor:
                    break
        except Exception as e:
            logger.error("無法取得 Slack 頻道 %s 的訊息：%s", channel_id, e)
            return [], None

        messages.sort(key=lambda m: float(m.get("ts", 0)))
        if messages:
            latest_ts = messages[-1].get("ts")
        return messages, latest_ts

    def _fetch_thread_replies(
        self,
        client: "WebClient",
        channel_id: str,
        thread_ts: str,
    ) -> list[dict]:
        try:
            resp = client.conversations_replies(channel=channel_id, ts=thread_ts)
            return resp.get("messages", [])[1:]  # 第一則是原始訊息本身
        except Exception:
            return []

    def _clean_text(self, text: str, user_map: dict[str, str]) -> str:
        if not text:
            return ""
        text = re.sub(r"<@([A-Z0-9]+)>", lambda m: f"@{user_map.get(m.group(1), m.group(1))}", text)
        text = re.sub(r"<#[A-Z0-9]+\|([^>]+)>", r"#\1", text)
        text = re.sub(r"<(https?://[^|>]+)\|?[^>]*>", r"\1", text)
        return text.strip()

    def _format_ts(self, ts: str) -> str:
        try:
            dt = datetime.fromtimestamp(float(ts), tz=timezone.utc).astimezone()
            return dt.strftime("%Y-%m-%d %H:%M")
        except Exception:
            return ts

    _SUPPORTED_ATTACHMENT_EXTS = {".pdf", ".docx", ".doc", ".txt", ".md", ".markdown"}

    def _fetch_attachments(
        self,
        messages: list[dict],
        channel_name: str,
        token: str,
        user_map: dict[str, str] | None = None,
    ) -> list[ConnectorDocument]:
        """從訊息的 files 欄位下載 PDF / Word / TXT，轉成 ConnectorDocument。"""
        docs: list[ConnectorDocument] = []
        seen: set[str] = set()

        for msg in messages:
            for f in msg.get("files", []):
                file_id: str = f.get("id", "")
                if not file_id or file_id in seen:
                    continue

                name: str = f.get("name", "")
                ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
                if ext not in self._SUPPORTED_ATTACHMENT_EXTS:
                    logger.debug("Slack 附件 %s 不支援，略過", name)
                    continue

                url: str = f.get("url_private_download") or f.get("url_private", "")
                if not url:
                    continue

                try:
                    resp = httpx.get(
                        url,
                        headers={"Authorization": f"Bearer {token}"},
                        timeout=30,
                        follow_redirects=True,
                    )
                    resp.raise_for_status()
                except Exception as e:
                    logger.warning("Slack 附件下載失敗 %s：%s", name, e)
                    continue

                content = extract_text(
                    file_bytes=resp.content,
                    content_type=f.get("mimetype"),
                    filename=name,
                )
                if not content.strip():
                    logger.info("Slack 附件 %s 無可擷取文字，略過", name)
                    continue

                seen.add(file_id)
                # 在文件開頭加上來源說明，幫助 RAG 定位
                ts = self._format_ts(msg.get("ts", ""))
                uid = msg.get("user", "")
                user_name = (user_map or {}).get(uid, uid)
                header = f"# {name}\n\n來源：Slack #{channel_name} · {ts}"
                if user_name:
                    header += f" · 上傳者：{user_name}"
                header += "\n\n---\n\n"

                # content 已是純文字，filename 統一用 .md 避免 extract_text 誤判格式
                name_base = name.rsplit(".", 1)[0] if "." in name else name
                docs.append(ConnectorDocument(
                    source_id=f"slack:file:{file_id}",
                    filename=f"slack_attach_{channel_name}_{name_base}.md",
                    content=header + content,
                    doc_type="article" if ext in {".pdf", ".docx", ".doc"} else "chat",
                    tags=["slack", f"#{channel_name}", "附件", ext.lstrip(".")],
                ))
                logger.info("Slack 附件 %s 擷取完成（%d 字）", name, len(content))

        return docs

    def _messages_to_markdown(
        self,
        messages: list[dict],
        channel_name: str,
        channel_id: str,
        user_map: dict[str, str],
        client: "WebClient",
        include_threads: bool,
        oldest_ts: str,
    ) -> str:
        today = datetime.now().strftime("%Y-%m-%d")
        lines = [
            f"# Slack #{channel_name} 頻道紀錄",
            f"",
            f"- 頻道：#{channel_name}（`{channel_id}`）",
            f"- 同步日期：{today}",
            f"",
            "---",
            "",
        ]

        _SKIP_SUBTYPES = {"bot_message", "channel_join", "channel_leave", "channel_topic", "channel_purpose"}

        for msg in messages:
            if msg.get("subtype") in _SKIP_SUBTYPES:
                continue
            text = self._clean_text(msg.get("text", ""), user_map)
            if not text:
                continue

            user_name = user_map.get(msg.get("user", ""), msg.get("user", "unknown"))
            ts = self._format_ts(msg.get("ts", ""))

            lines.append(f"### [{ts}] {user_name}")
            lines.append("")
            lines.append(text)
            lines.append("")

            if include_threads and msg.get("reply_count", 0) > 0:
                replies = self._fetch_thread_replies(client, channel_id, msg["ts"])
                if replies:
                    lines.append(f"**討論串（{len(replies)} 則回覆）：**")
                    lines.append("")
                    for reply in replies:
                        reply_text = self._clean_text(reply.get("text", ""), user_map)
                        if not reply_text:
                            continue
                        reply_user = user_map.get(reply.get("user", ""), reply.get("user", ""))
                        reply_ts = self._format_ts(reply.get("ts", ""))
                        lines.append(f"> **{reply_user}** [{reply_ts}]：{reply_text}")
                        lines.append(">")
                    lines.append("")

            lines.append("---")
            lines.append("")

        return "\n".join(lines)
