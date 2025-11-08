"""Local model management endpoints for llama.cpp integration."""

from __future__ import annotations

import logging
import shutil
import threading
from datetime import datetime, UTC
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from pydantic import BaseModel, Field

from pluto_duck_backend.agent.core.llm.llama_cpp_provider import _LocalModelManager
from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.chat import get_chat_repository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/models", tags=["models"])


class LocalModelInfo(BaseModel):
    id: str
    name: str
    path: str
    size_bytes: Optional[int] = None
    quantization: Optional[str] = None


class DownloadRequest(BaseModel):
    repo_id: str = Field(..., description="Hugging Face repo id, e.g. Qwen/Qwen3-8B-GGUF")
    filename: str = Field(..., description="GGUF filename in the repo")
    model_id: Optional[str] = Field(
        None,
        description="Friendly model identifier; defaults to filename stem",
    )


class SelectRequest(BaseModel):
    model_id: str = Field(..., description="Registered local model identifier")


class DownloadStatus(BaseModel):
    status: str
    detail: Optional[str] = None
    updated_at: datetime


class DownloadResponse(BaseModel):
    model_id: str
    status: str
    detail: Optional[str] = None


def _models_root() -> Path:
    return get_settings().data_dir.artifacts / "models" / "llama_cpp"


def _list_registered_models() -> List[Dict[str, Optional[str]]]:
    repo = get_chat_repository()
    settings = repo.get_settings()
    return list(settings.get("local_models") or [])


def _persist_models(models: List[Dict[str, Optional[str]]]) -> None:
    repo = get_chat_repository()
    repo.update_settings({"local_models": models})


_download_states_lock = threading.RLock()
_download_states: Dict[str, DownloadStatus] = {}


def _set_download_state(model_id: str, status: str, detail: Optional[str] = None) -> None:
    with _download_states_lock:
        _download_states[model_id] = DownloadStatus(
            status=status,
            detail=detail,
            updated_at=datetime.now(UTC),
        )


def _get_download_state(model_id: str) -> Optional[DownloadStatus]:
    with _download_states_lock:
        return _download_states.get(model_id)


@router.get("/local", response_model=List[LocalModelInfo])
def list_local_models() -> List[LocalModelInfo]:
    return [LocalModelInfo(**entry) for entry in _list_registered_models()]


def _upsert_local_model(info: LocalModelInfo) -> None:
    models = _list_registered_models()
    filtered = [entry for entry in models if entry.get("id") != info.id]
    filtered.append(info.model_dump())
    _persist_models(filtered)


def _perform_download(request: DownloadRequest, model_id: str) -> None:
    _set_download_state(model_id, "downloading")
    try:
        info = _download_model_sync(request, model_id)
        _upsert_local_model(info)
        _set_download_state(model_id, "completed")
    except HTTPException as exc:
        _set_download_state(model_id, "error", detail=str(exc.detail))
        logging.warning(
            "Local model download failed",
            extra={"model_id": model_id, "error_detail": exc.detail},
        )
    except Exception as exc:  # pragma: no cover
        _set_download_state(model_id, "error", detail=str(exc))
        logging.exception("Unexpected local model download failure", extra={"model_id": model_id})


def _download_model_sync(request: DownloadRequest, model_id: str) -> LocalModelInfo:
    try:
        from huggingface_hub import hf_hub_download  # type: ignore
        from huggingface_hub.errors import (
            EntryNotFoundError,  # type: ignore[attr-defined]
            HfHubHTTPError,
            RepositoryNotFoundError,
        )
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise HTTPException(
            status_code=500,
            detail="huggingface_hub is required to download models. Install with pip install 'huggingface_hub>=0.24'.",
        ) from exc

    root = _models_root()
    root.mkdir(parents=True, exist_ok=True)

    model_id = request.model_id or Path(request.filename).stem
    target_dir = root / model_id
    target_dir.mkdir(parents=True, exist_ok=True)

    logger.info(
        "Downloading local model",
        extra={
            "repo_id": request.repo_id,
            "hf_filename": request.filename,
            "model_id": model_id,
        },
    )

    try:
        downloaded_path = hf_hub_download(
            repo_id=request.repo_id,
            filename=request.filename,
            local_dir=str(target_dir),
            local_dir_use_symlinks=False,
            resume_download=True,
        )
    except RepositoryNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="Hugging Face repository not found or access is denied.",
        ) from exc
    except EntryNotFoundError as exc:  # type: ignore[misc]
        raise HTTPException(
            status_code=404,
            detail="Requested GGUF file not found in the repository.",
        ) from exc
    except HfHubHTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Hugging Face request failed: {exc}",
        ) from exc
    except Exception as exc:  # pragma: no cover - network/IO errors
        logger.exception(
            "Unexpected error while downloading local model",
            extra={
                "model_id": model_id,
                "repo_id": request.repo_id,
                "filename": request.filename,
            },
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to download model from Hugging Face.",
        ) from exc

    path = Path(downloaded_path)
    size_bytes = path.stat().st_size if path.exists() else None
    quantization = None
    lowercase_name = path.name.lower()
    if "q4_k_m" in lowercase_name:
        quantization = "q4_k_m"

    info = LocalModelInfo(
        id=model_id,
        name=model_id,
        path=str(path),
        size_bytes=size_bytes,
        quantization=quantization,
    )

    return info


@router.post("/local/download", response_model=DownloadResponse, status_code=status.HTTP_202_ACCEPTED)
def download_local_model(
    request: DownloadRequest,
    background_tasks: BackgroundTasks,
) -> DownloadResponse:
    model_id = request.model_id or Path(request.filename).stem
    current_state = _get_download_state(model_id)
    if current_state and current_state.status in {"queued", "downloading"}:
        return DownloadResponse(model_id=model_id, status=current_state.status, detail=current_state.detail)

    existing_models = _list_registered_models()
    entry = next((item for item in existing_models if item.get("id") == model_id), None)
    if entry:
        info = LocalModelInfo(**entry)
        _set_download_state(model_id, "completed")
        return DownloadResponse(model_id=model_id, status="completed", detail="Model already downloaded.")

    _set_download_state(model_id, "queued")
    background_tasks.add_task(_perform_download, request, model_id)
    return DownloadResponse(model_id=model_id, status="queued")


@router.get("/local/status", response_model=Dict[str, DownloadStatus])
def get_download_statuses() -> Dict[str, DownloadStatus]:
    with _download_states_lock:
        return {model_id: status for model_id, status in _download_states.items()}


@router.post("/local/load")
def load_local_model(request: SelectRequest) -> Dict[str, str]:
    models = _list_registered_models()
    entry = next((item for item in models if item.get("id") == request.model_id), None)
    if not entry or not entry.get("path"):
        raise HTTPException(status_code=404, detail="Model not installed")

    path = Path(entry["path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Model file not found on disk")

    _LocalModelManager.load(
        model_id=request.model_id,
        model_path=path,
        n_ctx=get_settings().agent.max_context_tokens,
        n_gpu_layers=get_settings().agent.n_gpu_layers,
        n_threads=get_settings().agent.n_threads,
    )
    return {"status": "loaded", "model_id": request.model_id}


@router.post("/local/unload")
def unload_local_model() -> Dict[str, str]:
    _LocalModelManager.unload()
    return {"status": "unloaded"}


@router.delete("/local/{model_id}")
def delete_local_model(model_id: str) -> Dict[str, str]:
    models = _list_registered_models()
    entry = next((item for item in models if item.get("id") == model_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Model not found")

    if _LocalModelManager.current_model_id() == model_id:
        _LocalModelManager.unload()

    path_value = entry.get("path")
    if path_value:
        model_path = Path(path_value)
        try:
            parent_dir: Optional[Path] = None
            if model_path.exists():
                if model_path.is_file():
                    parent_dir = model_path.parent
                    model_path.unlink()
                else:
                    parent_dir = model_path.parent if model_path.parent != model_path else model_path
                    shutil.rmtree(model_path)
            target_dir = parent_dir or model_path.parent
            if target_dir.exists() and target_dir.is_dir():
                try:
                    next(target_dir.iterdir())
                except StopIteration:
                    target_dir.rmdir()
        except Exception as exc:
            logger.warning(
                "Failed to delete local model files",
                extra={"model_id": model_id, "path": str(model_path)},
            )
            raise HTTPException(status_code=500, detail="Failed to delete model files") from exc

    filtered = [item for item in models if item.get("id") != model_id]
    _persist_models(filtered)
    return {"status": "deleted", "model_id": model_id}


