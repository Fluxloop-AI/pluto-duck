"""Execution plan models."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional


class StepAction(Enum):
    """Action to take for an execution step."""

    RUN = "run"  # Execute this step
    SKIP = "skip"  # Skip (already fresh)
    FAIL = "fail"  # Skip due to dependency failure


@dataclass
class ExecutionStep:
    """
    A single step in an execution plan.

    Represents one Analysis to be executed, with its compiled SQL
    and expected side effects.
    """

    analysis_id: str
    action: StepAction
    reason: str

    # Compiled SQL (only if action=RUN)
    compiled_sql: Optional[str] = None
    bound_params: Optional[List[Any]] = None

    # Side effects
    target_table: Optional[str] = None
    operation: Optional[str] = None  # CREATE VIEW | CREATE TABLE | INSERT | COPY

    def is_runnable(self) -> bool:
        """Check if this step should be executed."""
        return self.action == StepAction.RUN

    def __repr__(self) -> str:
        return f"ExecutionStep({self.analysis_id}, {self.action.value}, {self.reason})"


@dataclass
class ExecutionPlan:
    """
    Complete execution plan for one or more analyses.

    Contains all steps needed to execute a target analysis,
    including its dependencies in topological order.
    """

    target_id: str
    steps: List[ExecutionStep] = field(default_factory=list)
    params: Dict[str, Any] = field(default_factory=dict)

    created_at: datetime = field(default_factory=datetime.now)

    def summary(self) -> str:
        """
        Generate human-readable summary for HITL review.

        Returns:
            Multi-line string describing the execution plan
        """
        lines = [f"Execution Plan for '{self.target_id}':"]

        for i, step in enumerate(self.steps, 1):
            action_str = f"[{step.action.value.upper()}]".ljust(8)
            lines.append(f"  {i}. {action_str} analysis:{step.analysis_id} ({step.reason})")

        # Side effects section
        side_effects = self.will_modify_tables()
        if side_effects:
            lines.append("")
            lines.append("Side Effects:")
            for step in self.steps:
                if step.action == StepAction.RUN and step.target_table:
                    lines.append(f"  - {step.operation} {step.target_table}")

        return "\n".join(lines)

    def get_runnable_steps(self) -> List[ExecutionStep]:
        """Get only the steps that will be executed."""
        return [s for s in self.steps if s.action == StepAction.RUN]

    def will_modify_tables(self) -> List[str]:
        """Get list of tables that will be created/modified."""
        return [
            s.target_table
            for s in self.steps
            if s.action == StepAction.RUN and s.target_table
        ]

    def step_count(self) -> int:
        """Get total number of steps."""
        return len(self.steps)

    def runnable_count(self) -> int:
        """Get number of steps that will be executed."""
        return len(self.get_runnable_steps())

    def __repr__(self) -> str:
        return f"ExecutionPlan({self.target_id}, {self.step_count()} steps, {self.runnable_count()} to run)"

