"""內建 agent 目錄定義：產品出廠即固定的 agent 清單。

這是 agent_catalog 的 source of truth。系統啟動時會自動 upsert 至 DB，
無需手動透過後台 UI 輸入。新增或修改 agent 只需更新此檔案。
"""
from typing import TypedDict


class AgentDef(TypedDict):
    agent_id: str
    group_id: str
    group_name: str
    agent_name: str
    icon_name: str | None
    sort_id: str | None
    backend_router: str | None
    frontend_key: str | None


BUILTIN_AGENTS: list[AgentDef] = [
    {
        "group_id": "production",
        "group_name": "生產管理",
        "agent_id": "order",
        "agent_name": "Order Agent",
        "icon_name": None,
        "sort_id": "15",
        "backend_router": None,
        "frontend_key": None,
    },
    {
        "group_id": "sales",
        "group_name": "銷售管理",
        "agent_id": "quotation",
        "agent_name": "Quotation Agent",
        "icon_name": "Calculator",
        "sort_id": "21",
        "backend_router": None,
        "frontend_key": "agent-quotation",
    },
    {
        "group_id": "sales",
        "group_name": "銷售管理",
        "agent_id": "business",
        "agent_name": "Business Insight Agent",
        "icon_name": "ChartNoAxesCombined",
        "sort_id": "22",
        "backend_router": "neurosme_agent_bi.router",
        "frontend_key": "agent-bi",
    },
    {
        "group_id": "sales",
        "group_name": "銷售管理",
        "agent_id": "customer",
        "agent_name": "Customer Insight Agent",
        "icon_name": "UsersRound",
        "sort_id": "23",
        "backend_router": None,
        "frontend_key": "agent-customer",
    },
    {
        "group_id": "sales",
        "group_name": "銷售管理",
        "agent_id": "test01",
        "agent_name": "Test01 Agent",
        "icon_name": None,
        "sort_id": "24",
        "backend_router": None,
        "frontend_key": None,
    },
    {
        "group_id": "hr",
        "group_name": "人資管理",
        "agent_id": "interview",
        "agent_name": "Interview Agent",
        "icon_name": None,
        "sort_id": "31",
        "backend_router": None,
        "frontend_key": None,
    },
    {
        "group_id": "hr",
        "group_name": "人資管理",
        "agent_id": "scheduling",
        "agent_name": "Scheduling Agent",
        "icon_name": None,
        "sort_id": "32",
        "backend_router": None,
        "frontend_key": "agent-scheduling",
    },
    {
        "group_id": "rd",
        "group_name": "研發管理",
        "agent_id": "workorder",
        "agent_name": "Work Order Agent",
        "icon_name": None,
        "sort_id": "41",
        "backend_router": None,
        "frontend_key": None,
    },
    {
        "group_id": "financial",
        "group_name": "財務管理",
        "agent_id": "invoice",
        "agent_name": "Invoice Agent",
        "icon_name": None,
        "sort_id": "51",
        "backend_router": None,
        "frontend_key": None,
    },
    {
        "group_id": "production",
        "group_name": "生產管理",
        "agent_id": "chat",
        "agent_name": "Chat Agent",
        "icon_name": "Brain",
        "sort_id": "11",
        "backend_router": None,
        "frontend_key": None,
    },
]
