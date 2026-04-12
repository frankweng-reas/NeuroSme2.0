"""Activation Code 服務：產生、驗證、兌換授權碼。

Code 格式：{base64url(json_payload)}.{hmac_signature[:16]}
JSON payload 包含 customer_name、agent_ids、expires_at、nonce（唯一性）。
"""
import base64
import hashlib
import hmac
import json
import secrets
from datetime import date, datetime
from typing import TypedDict

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.activation_code import ActivationCode
from app.models.tenant_agent import TenantAgent
from app.services.startup_seed import seed_tenant_agents


class ActivationStatus(TypedDict):
    activated: bool
    customer_name: str | None
    agent_ids: list[str]
    expires_at: str | None
    is_expired: bool


def _sign(payload_b64: str) -> str:
    """用 ACTIVATION_SECRET 對 base64 payload 產生 HMAC-SHA256 簽名（取前 32 字元）"""
    sig = hmac.new(
        settings.ACTIVATION_SECRET.encode(),
        payload_b64.encode(),
        hashlib.sha256,
    ).hexdigest()
    return sig[:32]


def _hash_code(code: str) -> str:
    """對 code 做 SHA256，用於 DB 存儲（避免存明文）"""
    return hashlib.sha256(code.encode()).hexdigest()


def generate_code(
    customer_name: str,
    agent_ids: list[str],
    expires_at: date | None,
    db: Session,
) -> str:
    """產生一組 Activation Code 並寫入 DB（未啟用狀態）。"""
    payload = {
        "customer": customer_name,
        "agents": agent_ids,
        "expires": expires_at.isoformat() if expires_at else None,
        "nonce": secrets.token_hex(8),
    }
    payload_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    payload_b64 = base64.urlsafe_b64encode(payload_json.encode()).decode().rstrip("=")
    signature = _sign(payload_b64)
    code = f"{payload_b64}.{signature}"

    record = ActivationCode(
        code_hash=_hash_code(code),
        customer_name=customer_name,
        agent_ids=",".join(agent_ids),
        expires_at=expires_at,
    )
    db.add(record)
    db.commit()
    return code


class RedeemError(Exception):
    pass


def redeem_code(code: str, tenant_id: str, db: Session) -> ActivationCode:
    """兌換 Activation Code，成功後 seed tenant_agents。

    Raises:
        RedeemError: 格式錯誤 / 簽名無效 / 已過期 等情況
    """
    parts = code.strip().split(".")
    if len(parts) != 2:
        raise RedeemError("Code 格式無效")

    payload_b64, signature = parts[0], parts[1]

    # 驗簽
    expected = _sign(payload_b64)
    if not hmac.compare_digest(expected, signature):
        raise RedeemError("Code 無效或已被竄改")

    # 解析 payload
    try:
        padding = "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + padding).decode())
    except Exception:
        raise RedeemError("Code 格式無效")

    # 查 DB 記錄，若不存在則視為首次兌換（on-prem 場景：code 在 REAS 系統產生，客戶 DB 沒有預存記錄）
    code_hash = _hash_code(code)
    record = db.query(ActivationCode).filter(ActivationCode.code_hash == code_hash).first()
    if not record:
        # 簽名已驗過，直接從 payload 建立記錄
        expires_date = None
        if payload.get("expires"):
            try:
                expires_date = date.fromisoformat(payload["expires"])
            except ValueError:
                pass
        record = ActivationCode(
            code_hash=code_hash,
            customer_name=payload.get("customer", ""),
            agent_ids=",".join(payload.get("agents", [])),
            expires_at=expires_date,
        )
        db.add(record)
        db.flush()

    # 到期檢查
    if record.is_expired():
        raise RedeemError(f"Code 已於 {record.expires_at} 到期")

    # 已被其他 tenant 啟用
    if record.tenant_id and record.tenant_id != tenant_id:
        raise RedeemError("此 Code 已被其他租戶使用")

    # 執行授權：seed tenant_agents
    agent_ids = record.agent_ids_list
    seed_tenant_agents(db, agent_ids, tenant_ids=[tenant_id])

    # 更新記錄
    record.activated_at = datetime.utcnow()
    record.tenant_id = tenant_id
    db.commit()
    db.refresh(record)
    return record


def get_activation_status(tenant_id: str, db: Session) -> ActivationStatus:
    """回傳該 tenant 目前的啟用狀態。"""
    # 查最新一筆已啟用的 code
    record = (
        db.query(ActivationCode)
        .filter(
            ActivationCode.tenant_id == tenant_id,
            ActivationCode.activated_at.isnot(None),
        )
        .order_by(ActivationCode.activated_at.desc())
        .first()
    )

    # 有無 tenant_agents 決定是否已啟用
    has_agents = db.query(TenantAgent).filter(TenantAgent.tenant_id == tenant_id).first() is not None

    if record:
        return ActivationStatus(
            activated=has_agents,
            customer_name=record.customer_name,
            agent_ids=record.agent_ids_list,
            expires_at=record.expires_at.isoformat() if record.expires_at else None,
            is_expired=record.is_expired(),
        )
    return ActivationStatus(
        activated=has_agents,
        customer_name=None,
        agent_ids=[],
        expires_at=None,
        is_expired=False,
    )
