"""API 路由彙總：掛載 users、agents、source_files、prompt_templates、qtn_projects、bi_projects 等 endpoint"""
from fastapi import APIRouter
from app.api.endpoints import users, agents, agent_catalog, chat, chat_dev, chat_compute_tool, source_files, prompt_templates, tenants, qtn_projects, qtn_sources, qtn_catalogs, companies, scheduling, bi_projects, bi_sources, bi_schemas, bi_sample_qa, llm_configs

router = APIRouter()
router.include_router(users.router, prefix="/users", tags=["users"])
router.include_router(tenants.router, prefix="/tenants", tags=["tenants"])
router.include_router(agent_catalog.router, prefix="/agent-catalog", tags=["agent-catalog"])
router.include_router(agents.router, prefix="/agents", tags=["agents"])
router.include_router(chat.router, prefix="/chat", tags=["chat"])
router.include_router(chat_dev.router, prefix="/chat/dev", tags=["chat-dev"])
router.include_router(chat_compute_tool.router, prefix="/chat", tags=["chat-compute-tool"])
router.include_router(source_files.router, prefix="/source-files", tags=["source-files"])
router.include_router(prompt_templates.router, prefix="/prompt-templates", tags=["prompt-templates"])
router.include_router(qtn_projects.router, prefix="/qtn-projects", tags=["qtn-projects"])
router.include_router(qtn_sources.router, prefix="/qtn-sources", tags=["qtn-sources"])
router.include_router(qtn_catalogs.router, prefix="/qtn-catalogs", tags=["qtn-catalogs"])
router.include_router(companies.router, prefix="/companies", tags=["companies"])
router.include_router(scheduling.router, prefix="/scheduling", tags=["scheduling"])
router.include_router(bi_projects.router, prefix="/bi-projects", tags=["bi-projects"])
router.include_router(bi_sources.router, prefix="/bi-sources", tags=["bi-sources"])
router.include_router(bi_schemas.router, prefix="/bi-schemas", tags=["bi-schemas"])
router.include_router(bi_sample_qa.router, prefix="/bi-sample-qa", tags=["bi-sample-qa"])
router.include_router(llm_configs.router, prefix="/llm-configs", tags=["llm-configs"])
