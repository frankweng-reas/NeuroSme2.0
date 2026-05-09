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
        "group_id": "sales",
        "group_name": "銷售管理",
        "agent_id": "quotation",
        "agent_name": "Quotation",
        "icon_name": "Calculator",
        "sort_id": "21",
        "backend_router": None,
        "frontend_key": "agent-quotation",
    },
    {
        "group_id": "sales",
        "group_name": "分析",
        "agent_id": "business",
        "agent_name": "Business Insight",
        "icon_name": "ChartNoAxesCombined",
        "sort_id": "22",
        "backend_router": "neurosme_agent_bi.router",
        "frontend_key": "agent-bi",
    },
    {
        "group_id": "sales",
        "group_name": "銷售管理",
        "agent_id": "customer",
        "agent_name": "Customer Insight",
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
        "agent_name": "Interview",
        "icon_name": None,
        "sort_id": "31",
        "backend_router": None,
        "frontend_key": None,
    },
    {
        "group_id": "financial",
        "group_name": "財務管理",
        "agent_id": "invoice",
        "agent_name": "Invoice",
        "icon_name": None,
        "sort_id": "51",
        "backend_router": None,
        "frontend_key": None,
    },
    {
        "group_id": "production",
        "group_name": "生產力",
        "agent_id": "ocr",
        "agent_name": "OCR / Vision",
        "icon_name": "ScanText",
        "sort_id": "14",
        "backend_router": None,
        "frontend_key": "agent-ocr",
    },
    {
        "group_id": "production",
        "group_name": "生產力",
        "agent_id": "writing",
        "agent_name": "Writing",
        "icon_name": "FileText",
        "sort_id": "15",
        "backend_router": None,
        "frontend_key": "agent-writing",
    },
    {
        "group_id": "marketing",
        "group_name": "行銷",
        "agent_id": "marketing",
        "agent_name": "Marketing Writer",
        "icon_name": "Megaphone",
        "sort_id": "16",
        "backend_router": None,
        "frontend_key": "agent-marketing",
    },
    {
        "group_id": "production",
        "group_name": "生產力",
        "agent_id": "chat",
        "agent_name": "Chat",
        "icon_name": "Brain",
        "sort_id": "11",
        "backend_router": None,
        "frontend_key": None,
    },
    {
        "group_id": "knowledge",
        "group_name": "知識管理",
        "agent_id": "kb-manager",
        "agent_name": "Knowledge Base",
        "icon_name": "book-open",
        "sort_id": "14",
        "backend_router": None,
        "frontend_key": "agent-kb-manager",
    },
    {
        "group_id": "knowledge",
        "group_name": "知識管理",
        "agent_id": "kb-bot-builder",
        "agent_name": "Bot Builder",
        "icon_name": "Bot",
        "sort_id": "15",
        "backend_router": None,
        "frontend_key": "agent-kb-bot-builder",
    },
    {
        "group_id": "knowledge",
        "group_name": "知識管理",
        "agent_id": "doc-refiner",
        "agent_name": "Doc Refiner",
        "icon_name": "FilePen",
        "sort_id": "13",
        "backend_router": None,
        "frontend_key": "agent-doc-refiner",
    },
]
