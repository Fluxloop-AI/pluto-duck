"""Source API Router - External database federation and caching."""

from fastapi import APIRouter

from pluto_duck_backend.app.api.v1.source.attach import router as attach_router
from pluto_duck_backend.app.api.v1.source.cache import router as cache_router
from pluto_duck_backend.app.api.v1.source.folders import router as folders_router


router = APIRouter(tags=["source"])

router.include_router(attach_router, prefix="", tags=["source"])
router.include_router(cache_router, prefix="/cache", tags=["source"])
router.include_router(folders_router, prefix="/folders", tags=["source"])
