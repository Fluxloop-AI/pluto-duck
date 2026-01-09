"""Execution result models."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

from duckpipe.core.plan import ExecutionPlan


@dataclass
class StepResult:
    """
    Result of executing a single step.

    Records timing, status, and any errors from execution.
    """

    run_id: str
    analysis_id: str
    status: str  # success | failed | skipped
    started_at: datetime

    finished_at: Optional[datetime] = None
    rows_affected: Optional[int] = None
    error: Optional[str] = None
    duration_ms: Optional[int] = None

    def is_success(self) -> bool:
        """Check if execution was successful."""
        return self.status == "success"

    def is_failed(self) -> bool:
        """Check if execution failed."""
        return self.status == "failed"

    def is_skipped(self) -> bool:
        """Check if execution was skipped."""
        return self.status == "skipped"

    def __repr__(self) -> str:
        duration = f", {self.duration_ms}ms" if self.duration_ms else ""
        return f"StepResult({self.analysis_id}, {self.status}{duration})"


@dataclass
class ExecutionResult:
    """
    Complete result of executing an execution plan.

    Contains results for all steps in the plan.
    """

    plan: ExecutionPlan
    success: bool
    step_results: List[StepResult] = field(default_factory=list)

    @property
    def failed_step(self) -> Optional[StepResult]:
        """Get the first failed step, if any."""
        for r in self.step_results:
            if r.status == "failed":
                return r
        return None

    @property
    def total_duration_ms(self) -> int:
        """Get total execution duration in milliseconds."""
        return sum(r.duration_ms or 0 for r in self.step_results)

    @property
    def success_count(self) -> int:
        """Get number of successful steps."""
        return sum(1 for r in self.step_results if r.status == "success")

    @property
    def failed_count(self) -> int:
        """Get number of failed steps."""
        return sum(1 for r in self.step_results if r.status == "failed")

    @property
    def skipped_count(self) -> int:
        """Get number of skipped steps."""
        return sum(1 for r in self.step_results if r.status == "skipped")

    def summary(self) -> str:
        """Generate human-readable summary."""
        status = "SUCCESS" if self.success else "FAILED"
        lines = [
            f"Execution Result: {status}",
            f"  Target: {self.plan.target_id}",
            f"  Steps: {len(self.step_results)} total",
            f"    - Success: {self.success_count}",
            f"    - Failed: {self.failed_count}",
            f"    - Skipped: {self.skipped_count}",
            f"  Duration: {self.total_duration_ms}ms",
        ]

        if self.failed_step:
            lines.append(f"  Error: {self.failed_step.error}")

        return "\n".join(lines)

    def __repr__(self) -> str:
        status = "success" if self.success else "failed"
        return f"ExecutionResult({self.plan.target_id}, {status}, {len(self.step_results)} steps)"


@dataclass
class AnalysisStatus:
    """
    Current status of an Analysis.

    Used for status queries and freshness checks.
    """

    analysis_id: str
    is_stale: bool
    last_run_at: Optional[datetime]
    last_run_status: Optional[str]
    depends_on: List[str]
    depended_by: List[str]

    def __repr__(self) -> str:
        freshness = "stale" if self.is_stale else "fresh"
        return f"AnalysisStatus({self.analysis_id}, {freshness})"

