"""權限 service：查詢使用者可存取的 agent"""
from sqlalchemy.orm import Session

from app.models.user_agent import UserAgent


def get_agent_ids_for_user(db: Session, user_id: int) -> set[str]:
    """回傳該 user 可存取的 agent_id 集合。若 user_agents 無資料則回傳空集合。"""
    rows = db.query(UserAgent.agent_id).filter(UserAgent.user_id == user_id).all()
    return {r.agent_id for r in rows}
