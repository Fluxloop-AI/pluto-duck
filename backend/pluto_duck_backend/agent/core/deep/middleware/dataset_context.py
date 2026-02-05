"""Ephemeral dataset readiness context injection."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import NotRequired, TypedDict, cast

from langchain.agents.middleware.types import AgentMiddleware, AgentState, ModelRequest, ModelResponse

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
        if self._project_id is None:
            readiness_summary = _format_dataset_readiness_summary(
                total=0,
                ready_count=0,
                not_ready_count=0,
            )
            return DatasetContextStateUpdate(dataset_readiness_summary=readiness_summary)

        file_service: FileAssetService = get_file_asset_service(self._project_id)
        preprocessing_service: FilePreprocessingService = get_file_preprocessing_service(self._project_id)
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

        return DatasetContextStateUpdate(dataset_readiness_summary=readiness_summary)

    def wrap_model_call(self, request: ModelRequest, handler: Callable[[ModelRequest], ModelResponse]) -> ModelResponse:
        state = cast("DatasetContextState", request.state)
        summary = state.get("dataset_readiness_summary") or ""
        if summary:
            system_prompt = (request.system_prompt + "\n\n" + summary) if request.system_prompt else summary
            return handler(request.override(system_prompt=system_prompt))
        return handler(request)

    async def awrap_model_call(
        self, request: ModelRequest, handler: Callable[[ModelRequest], Awaitable[ModelResponse]]
    ) -> ModelResponse:
        state = cast("DatasetContextState", request.state)
        summary = state.get("dataset_readiness_summary") or ""
        if summary:
            system_prompt = (request.system_prompt + "\n\n" + summary) if request.system_prompt else summary
            return await handler(request.override(system_prompt=system_prompt))
        return await handler(request)
