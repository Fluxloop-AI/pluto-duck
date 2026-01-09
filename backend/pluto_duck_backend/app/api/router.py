"""FastAPI router wiring for Pluto-Duck backend."""

from fastapi import APIRouter

from .v1 import actions, agent, asset, boards, chat, query, settings, projects, models, source

api_router = APIRouter()
api_router.include_router(query.router, prefix="/api/v1/query", tags=["query"])
api_router.include_router(actions.router, prefix="/api/v1/actions", tags=["actions"])
api_router.include_router(agent.router, prefix="/api/v1/agent", tags=["agent"])
api_router.include_router(chat.router, prefix="/api/v1/chat", tags=["chat"])
api_router.include_router(settings.router, prefix="/api/v1", tags=["settings"])
api_router.include_router(boards.router, prefix="/api/v1", tags=["boards"])
api_router.include_router(projects.router, prefix="/api/v1", tags=["projects"])
api_router.include_router(models.router, prefix="/api/v1", tags=["models"])
api_router.include_router(source.router, prefix="/api/v1", tags=["source"])  # ATTACH + Cache
api_router.include_router(asset.router, prefix="/api/v1", tags=["asset"])  # Saved Analyses

