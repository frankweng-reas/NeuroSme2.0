"""API 測試：驗證 users、agents、user_agents 相關功能"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
API = "/api/v1"


def test_health():
    """Health check"""
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_get_user_by_email():
    """取得 test01 使用者"""
    r = client.get(f"{API}/users/by-email?email=test01@test.com")
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == "test01@test.com"
    assert data["username"].lower() == "test01"
    assert "id" in data


def test_list_users():
    """列出所有使用者"""
    r = client.get(f"{API}/users/")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_list_agents_all():
    """取得所有 agents（無 user_id 過濾）"""
    r = client.get(f"{API}/agents/")
    assert r.status_code == 200
    agents = r.json()
    assert isinstance(agents, list)


def test_get_user_agents():
    """取得 test01 的 agent 權限"""
    # 先取得 test01 的 id
    r = client.get(f"{API}/users/by-email?email=test01@test.com")
    assert r.status_code == 200
    user_id = r.json()["id"]

    r = client.get(f"{API}/users/{user_id}/agents")
    assert r.status_code == 200
    data = r.json()
    assert "agent_ids" in data
    assert isinstance(data["agent_ids"], list)


def test_agents_for_user():
    """test01 登入後應能取得有權限的 agents"""
    r = client.get(f"{API}/users/by-email?email=test01@test.com")
    assert r.status_code == 200
    user_id = r.json()["id"]

    r = client.get(f"{API}/agents/?user_id={user_id}")
    assert r.status_code == 200
    agents = r.json()
    assert isinstance(agents, list)


def test_update_user_agents_roundtrip():
    """更新 user agents 並驗證"""
    # 取得 test01
    r = client.get(f"{API}/users/by-email?email=test01@test.com")
    assert r.status_code == 200
    user_id = r.json()["id"]

    # 取得目前 agent_ids
    r = client.get(f"{API}/users/{user_id}/agents")
    assert r.status_code == 200
    original_ids = r.json()["agent_ids"]

    # 取得所有 agents
    r = client.get(f"{API}/agents/")
    assert r.status_code == 200
    all_agents = r.json()
    if not all_agents:
        pytest.skip("No agents in DB")

    all_ids = [a["id"] for a in all_agents]

    # 更新：選第一個 agent（或空）
    new_ids = all_ids[:1] if all_ids else []
    r = client.put(
        f"{API}/users/{user_id}/agents",
        json={"agent_ids": new_ids},
    )
    assert r.status_code == 200

    # 驗證
    r = client.get(f"{API}/users/{user_id}/agents")
    assert r.json()["agent_ids"] == new_ids

    # 還原
    client.put(
        f"{API}/users/{user_id}/agents",
        json={"agent_ids": original_ids},
    )
