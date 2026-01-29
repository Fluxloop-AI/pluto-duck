"""Boards API router."""

from fastapi import APIRouter

from pluto_duck_backend.app.api.v1.boards.boards import router as boards_router
from pluto_duck_backend.app.api.v1.boards.items import router as items_router
from pluto_duck_backend.app.api.v1.boards.queries import router as queries_router


router = APIRouter(tags=["boards"])

router.include_router(boards_router, prefix="", tags=["boards"])
router.include_router(items_router, prefix="", tags=["boards"])
router.include_router(queries_router, prefix="", tags=["boards"])
