"""Core agent state models used by the LangGraph skeleton."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


class MessageRole(str, Enum):
    """Supported message roles within the agent conversation state."""

    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    TOOL = "tool"
    REASONING = "reasoning"


@dataclass
class AgentMessage:
    """Represents a single message exchanged during an agent run."""

    role: MessageRole
    content: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PlanStep:
    """A structured step produced by the planner node."""

    description: str
    status: str = "pending"
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AgentState:
    """State object shared between LangGraph nodes during a run."""

    conversation_id: str
    user_query: str
    messages: List[AgentMessage] = field(default_factory=list)
    plan: List[PlanStep] = field(default_factory=list)
    last_tool_name: Optional[str] = None
    working_sql: Optional[str] = None
    verification_result: Optional[Dict[str, Any]] = None
    context: Dict[str, Any] = field(default_factory=dict)
    model: Optional[str] = None
    preferred_tables: Optional[List[str]] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def add_message(
        self,
        role: MessageRole,
        content: str,
        *,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> AgentMessage:
        """Append a message to the state and return it."""

        message = AgentMessage(role=role, content=content, metadata=metadata or {})
        self.messages.append(message)
        return message

    def update_plan(self, steps: List[PlanStep]) -> None:
        """Replace the current plan with the provided steps."""

        self.plan = steps

    def to_dict(self) -> Dict[str, Any]:
        """Serialize state for logging or debugging purposes."""

        return {
            "conversation_id": self.conversation_id,
            "user_query": self.user_query,
            "messages": [
                {
                    "role": message.role.value,
                    "content": message.content,
                    "created_at": message.created_at.isoformat(),
                    "metadata": message.metadata,
                }
                for message in self.messages
            ],
            "plan": [
                {
                    "description": step.description,
                    "status": step.status,
                    "metadata": step.metadata,
                }
                for step in self.plan
            ],
            "last_tool_name": self.last_tool_name,
            "working_sql": self.working_sql,
            "verification_result": self.verification_result,
            "context": self.context,
            "model": self.model,
            "preferred_tables": self.preferred_tables,
            "metadata": self.metadata,
        }


