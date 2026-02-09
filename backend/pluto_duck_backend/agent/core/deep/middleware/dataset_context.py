"""Ephemeral dataset readiness context injection."""

from __future__ import annotations

import logging
from typing import NotRequired, TypedDict

from langchain.agents.middleware.types import AgentMiddleware, AgentState

from pluto_duck_backend.app.services.asset import (
    FileAssetService,
    FilePreprocessingService,
    get_file_asset_service,
    get_file_preprocessing_service,
)

DATASET_READINESS_INSTRUCTION = """
**IMPORTANT**: If `not_ready` > 0 and the user requests analysis, diagnosis, metrics, or modeling:
1. Read the `dataset-readiness` skill at `/skills/user/skills/dataset-readiness/SKILL.md`
2. Follow the skill's workflow before proceeding with analysis
""".strip()

logger = logging.getLogger(__name__)


class DatasetContextState(AgentState):
    dataset_readiness_summary: NotRequired[str]


class DatasetContextStateUpdate(TypedDict):
    dataset_readiness_summary: str


def _format_dataset_readiness_summary(
    *,
    total: int,
    ready_count: int,
    not_ready_count: int,
) -> str:
    lines: list[str] = [
        "## Dataset Readiness Context",
        "",
        "<dataset_readiness>",
        f"datasets: {total}",
        f"ready: {ready_count}",
        f"not_ready: {not_ready_count}",
        "</dataset_readiness>",
    ]

    if not_ready_count > 0:
        lines.append("")
        lines.append(DATASET_READINESS_INSTRUCTION)

    return "\n".join(lines)


class DatasetContextMiddleware(AgentMiddleware):
    """Injects dataset readiness summary into the system prompt (ephemeral)."""

    state_schema = DatasetContextState

    def __init__(self, *, project_id: str | None) -> None:
        self._project_id = project_id

    def before_agent(
        self,
        state: DatasetContextState,
        runtime,
    ) -> DatasetContextStateUpdate | None:  # type: ignore[override]
        import time
        start = time.perf_counter()

        if self._project_id is None:
            readiness_summary = _format_dataset_readiness_summary(
                total=0,
                ready_count=0,
                not_ready_count=0,
            )
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.debug(
                "DatasetContextMiddleware.before_agent elapsed_ms=%.3f no_project=true",
                elapsed_ms,
            )
            return DatasetContextStateUpdate(dataset_readiness_summary=readiness_summary)

        file_service: FileAssetService = get_file_asset_service(self._project_id)
        preprocessing_service: FilePreprocessingService = get_file_preprocessing_service(
            self._project_id
        )
        assets = file_service.list_files()

        total = len(assets)
        ready_count = 0
        not_ready_count = 0

        for asset in assets:
            effective = preprocessing_service.get_effective_status(
                file_asset_id=asset.id,
                current_diagnosis_id=asset.diagnosis_id,
            )
            if effective.status == "ready":
                ready_count += 1
            else:
                not_ready_count += 1

        readiness_summary = _format_dataset_readiness_summary(
            total=total,
            ready_count=ready_count,
            not_ready_count=not_ready_count,
        )

        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.debug(
            "DatasetContextMiddleware.before_agent elapsed_ms=%.3f assets=%s",
            elapsed_ms,
            total,
        )
        return DatasetContextStateUpdate(dataset_readiness_summary=readiness_summary)
