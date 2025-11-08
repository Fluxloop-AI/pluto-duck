"""llama.cpp-based provider for local GGUF models."""

from __future__ import annotations

import asyncio
import gc
import logging
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from pluto_duck_backend.app.core.config import get_settings
from .providers import BaseLLMProvider

logger = logging.getLogger(__name__)

try:  # Optional dependency; only required when using local models
    from llama_cpp import Llama  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    Llama = None  # type: ignore


class _LocalModelManager:
    """Process-wide cache for a single loaded llama.cpp model."""

    _lock = threading.RLock()
    _llama: Optional[Llama] = None
    _model_id: Optional[str] = None
    _model_path: Optional[Path] = None

    @classmethod
    def load(
        cls,
        model_id: str,
        model_path: Path,
        n_ctx: int,
        n_gpu_layers: int,
        n_threads: int,
    ) -> None:
        if Llama is None:
            raise RuntimeError(
                "llama-cpp-python is not installed. Install it via "
                "pip install 'llama-cpp-python>=0.3.2'"
            )

        with cls._lock:
            if (
                cls._llama is not None
                and cls._model_id == model_id
                and cls._model_path == model_path
            ):
                return

            cls._llama = None
            cls._model_id = None
            cls._model_path = None
            gc.collect()

            logger.info(
                "Loading llama.cpp model",
                extra={
                    "model_id": model_id,
                    "model_path": str(model_path),
                    "n_ctx": n_ctx,
                    "n_gpu_layers": n_gpu_layers,
                    "n_threads": n_threads,
                },
            )

            cls._llama = Llama(
                model_path=str(model_path),
                n_ctx=n_ctx,
                n_gpu_layers=n_gpu_layers,
                n_threads=None if n_threads <= 0 else n_threads,
                vocab_only=False,
                logits_all=False,
                embedding=False,
            )
            cls._model_id = model_id
            cls._model_path = model_path

    @classmethod
    def unload(cls) -> None:
        with cls._lock:
            if cls._llama is not None:
                logger.info(
                    "Unloading llama.cpp model",
                    extra={"model_id": cls._model_id},
                )
            cls._llama = None
            cls._model_id = None
            cls._model_path = None
            gc.collect()

    @classmethod
    def get(cls) -> Optional[Llama]:
        return cls._llama

    @classmethod
    def current_model_id(cls) -> Optional[str]:
        return cls._model_id


def _resolve_local_model_path(model_id: str) -> Optional[Path]:
    """Return filesystem path for a given local model id if available."""

    try:
        from pluto_duck_backend.app.services.chat import get_chat_repository

        repo = get_chat_repository()
        settings = repo.get_settings()
        for entry in settings.get("local_models") or []:
            if entry.get("id") == model_id and entry.get("path"):
                path = Path(entry["path"])
                if path.exists():
                    return path
    except Exception:  # pragma: no cover - repository optional during bootstrap
        pass

    root = get_settings().data_dir.artifacts / "models" / "llama_cpp" / model_id
    for candidate in root.glob("*.gguf"):
        return candidate
    return None


class LlamaCppLLMProvider(BaseLLMProvider):
    """Local llama.cpp-backed provider."""

    def __init__(self, model_id: str) -> None:
        path = _resolve_local_model_path(model_id)
        if path is None:
            raise RuntimeError(
                f"Local model '{model_id}' is not installed. "
                "Download it via the models API or settings UI."
            )

        self._model_id = model_id
        self._model_path = path
        agent_settings = get_settings().agent
        self._n_ctx = int(getattr(agent_settings, "max_context_tokens", 8192))
        self._n_gpu_layers = int(getattr(agent_settings, "n_gpu_layers", -1))
        self._n_threads = int(getattr(agent_settings, "n_threads", 0))
        self._semaphore = asyncio.Semaphore(1)

    async def _ensure_loaded(self) -> None:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            _LocalModelManager.load,
            self._model_id,
            self._model_path,
            self._n_ctx,
            self._n_gpu_layers,
            self._n_threads,
        )

    async def ainvoke(
        self,
        prompt: str,
        *,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        await self._ensure_loaded()
        llama = _LocalModelManager.get()
        if llama is None:
            raise RuntimeError("Local llama.cpp model is not loaded")

        temperature = 0.7
        if metadata and isinstance(metadata, dict):
            temperature = float(metadata.get("temperature", temperature))

        async with self._semaphore:
            loop = asyncio.get_running_loop()

            def _run() -> str:
                response = llama.create_completion(
                    prompt=prompt,
                    max_tokens=getattr(get_settings().agent, "max_output_tokens", None) or 512,
                    temperature=temperature,
                    top_p=0.95,
                )
                choices = response.get("choices") or []
                if not choices:
                    return ""
                text = choices[0].get("text")
                return text or ""

            return await loop.run_in_executor(None, _run)


__all__ = ["LlamaCppLLMProvider", "_LocalModelManager"]


