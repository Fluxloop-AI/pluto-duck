"""Tests for dataset readiness context formatting."""

from __future__ import annotations

from pluto_duck_backend.agent.core.deep.middleware.dataset_context import (
    DatasetContextMiddleware,
    _format_dataset_readiness_summary,
)


def test_format_summary_basic() -> None:
    summary = _format_dataset_readiness_summary(
        total=3,
        ready_count=1,
        not_ready_count=2,
    )

    assert "<dataset_readiness>" in summary
    assert "datasets: 3" in summary
    assert "ready: 1" in summary
    assert "not_ready: 2" in summary
    assert "</dataset_readiness>" in summary


def test_format_summary_empty() -> None:
    summary = _format_dataset_readiness_summary(
        total=0,
        ready_count=0,
        not_ready_count=0,
    )

    assert "datasets: 0" in summary
    assert "ready: 0" in summary
    assert "not_ready: 0" in summary


def test_format_summary_includes_instruction_when_not_ready() -> None:
    """not_ready > 0일 때 스킬 트리거 지시문이 포함되어야 함."""
    summary = _format_dataset_readiness_summary(
        total=5,
        ready_count=3,
        not_ready_count=2,
    )

    assert "dataset-readiness" in summary
    assert "/skills/user/skills/dataset-readiness/SKILL.md" in summary
    assert "**IMPORTANT**" in summary


def test_format_summary_no_instruction_when_all_ready() -> None:
    """모든 데이터셋이 ready일 때는 지시문이 포함되지 않아야 함."""
    summary = _format_dataset_readiness_summary(
        total=5,
        ready_count=5,
        not_ready_count=0,
    )

    assert "<dataset_readiness>" in summary
    assert "dataset-readiness" not in summary or "SKILL.md" not in summary


def test_before_agent_returns_zero_summary_when_no_project() -> None:
    middleware = DatasetContextMiddleware(project_id=None)

    update = middleware.before_agent({"messages": []}, None)

    assert update is not None
    summary = update["dataset_readiness_summary"]
    assert "datasets: 0" in summary
    assert "ready: 0" in summary
    assert "not_ready: 0" in summary
