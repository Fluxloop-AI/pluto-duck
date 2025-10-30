"""Chat API endpoints for persisted conversations and settings."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel

from pluto_duck_backend.app.services.chat import ChatRepository, ConversationSummary, get_chat_repository
from pluto_duck_backend.agent.core.orchestrator import get_agent_manager

router = APIRouter()


class ConversationResponse(BaseModel):
  id: str
  title: Optional[str]
  status: str
  created_at: str
  updated_at: str
  last_message_preview: Optional[str]
  run_id: Optional[str] = None
  project_id: Optional[str] = None


class ConversationDetailResponse(BaseModel):
  id: str
  status: str
  messages: List[Dict[str, Any]]
  events: Optional[List[Dict[str, Any]]] = None
  run_id: Optional[str] = None


class CreateConversationRequest(BaseModel):
  question: Optional[str] = None
  metadata: Optional[Dict[str, Any]] = None
  conversation_id: Optional[str] = None
  model: Optional[str] = None


class CreateConversationResponse(BaseModel):
  id: str
  run_id: Optional[str] = None
  events_url: Optional[str] = None
  conversation_id: Optional[str] = None


class AppendMessageRequest(BaseModel):
  role: str
  content: Dict[str, Any]
  model: Optional[str] = None
  metadata: Optional[Dict[str, Any]] = None
  run_id: Optional[str] = None


class AppendMessageResponse(BaseModel):
  status: str
  run_id: Optional[str] = None
  events_url: Optional[str] = None
  conversation_id: Optional[str] = None


class SettingsResponse(BaseModel):
  data_sources: Optional[Any] = None
  dbt_project: Optional[Any] = None
  ui_preferences: Optional[Any] = None
  llm_provider: Optional[Any] = None


class UpdateSettingsRequest(BaseModel):
  data_sources: Optional[Any] = None
  dbt_project: Optional[Any] = None
  ui_preferences: Optional[Any] = None
  llm_provider: Optional[Any] = None


def get_repository() -> ChatRepository:
  return get_chat_repository()


@router.get("/sessions", response_model=List[ConversationResponse])
def list_conversations(
  limit: int = Query(default=50, ge=1, le=200),
  offset: int = Query(default=0, ge=0),
  project_id: Optional[str] = Query(default=None),
  repo: ChatRepository = Depends(get_repository),
) -> List[ConversationResponse]:
  summaries = repo.list_conversations(limit=limit, offset=offset, project_id=project_id)
  return [
    ConversationResponse(
      id=str(item.id),
      title=item.title,
      status=item.status,
      created_at=item.created_at.isoformat(),
      updated_at=item.updated_at.isoformat(),
      last_message_preview=item.last_message_preview,
      run_id=str(item.run_id) if item.run_id is not None else None,
      project_id=item.project_id,
    )
    for item in summaries
  ]


@router.post("/sessions", response_model=CreateConversationResponse, status_code=status.HTTP_201_CREATED)
async def create_conversation(
  payload: CreateConversationRequest,
  repo: ChatRepository = Depends(get_repository),
) -> CreateConversationResponse:
  manager = get_agent_manager()
  if payload.question and payload.conversation_id:
    try:
      run_id = manager.start_run_for_conversation(
        payload.conversation_id,
        payload.question,
        model=payload.model,
        metadata=payload.metadata,
      )
      return CreateConversationResponse(
        id=payload.conversation_id,
        run_id=run_id,
        events_url=f"/api/v1/agent/{run_id}/events",
        conversation_id=payload.conversation_id,
      )
    except KeyError as exc:
      raise HTTPException(status_code=404, detail="Conversation not found") from exc

  if payload.question:
    conversation_id, run_id = manager.start_run(
      payload.question,
      model=payload.model,
      metadata=payload.metadata,
    )
    # Preserve existing metadata (especially project_id) and add model if not present
    metadata = dict(payload.metadata or {})  # Create a copy to avoid mutation
    if payload.model and "model" not in metadata:
      metadata["model"] = payload.model
    repo.create_conversation(conversation_id, payload.question, metadata)
    return CreateConversationResponse(id=conversation_id, run_id=run_id, events_url=f"/api/v1/agent/{run_id}/events", conversation_id=conversation_id)

  conversation_id = payload.conversation_id or repo._generate_uuid()  # type: ignore[attr-defined]
  repo.create_conversation(conversation_id, payload.question or "", payload.metadata)
  return CreateConversationResponse(id=conversation_id)


@router.get("/sessions/{conversation_id}", response_model=ConversationDetailResponse)
def get_conversation(
  conversation_id: str,
  include_events: bool = Query(default=False),
  project_id: Optional[str] = Query(default=None),
  repo: ChatRepository = Depends(get_repository),
) -> ConversationDetailResponse:
  summary = repo.get_conversation_summary(conversation_id)
  if summary is None:
    raise HTTPException(status_code=404, detail="Conversation not found")
  
  # Verify project_id if provided (security check)
  if project_id and summary.project_id != project_id:
    raise HTTPException(status_code=404, detail="Conversation not found")
  messages = repo.get_conversation_messages(conversation_id)
  events = repo.get_conversation_events(conversation_id) if include_events else None
  conversation_status = summary.status
  run_id = summary.run_id
  return ConversationDetailResponse(
    id=conversation_id,
    status=conversation_status,
    messages=messages,
    events=events,
    run_id=str(run_id) if run_id is not None else None,
  )


@router.post("/sessions/{conversation_id}/messages", response_model=AppendMessageResponse, status_code=status.HTTP_202_ACCEPTED)
async def append_message(
  conversation_id: str,
  payload: AppendMessageRequest,
  project_id: Optional[str] = Query(default=None),
  repo: ChatRepository = Depends(get_repository),
) -> AppendMessageResponse:
  # Verify project_id if provided (security check)
  if project_id:
    summary = repo.get_conversation_summary(conversation_id)
    if not summary or summary.project_id != project_id:
      raise HTTPException(status_code=404, detail="Conversation not found")
  
  manager = get_agent_manager()
  if payload.role.lower() == "user":
    try:
      run_id = manager.start_run_for_conversation(
        conversation_id,
        payload.content.get("text", ""),
        model=payload.model,
        metadata=payload.metadata,
      )
    except KeyError as exc:
      raise HTTPException(status_code=404, detail="Conversation not found") from exc
    return AppendMessageResponse(status="queued", run_id=run_id, events_url=f"/api/v1/agent/{run_id}/events", conversation_id=conversation_id)

  repo.append_message(conversation_id, payload.role, payload.content, run_id=payload.run_id)
  return AppendMessageResponse(status="appended", conversation_id=conversation_id)


@router.get("/sessions/{conversation_id}/events", response_model=List[Dict[str, Any]])
def get_events(
  conversation_id: str,
  repo: ChatRepository = Depends(get_repository),
) -> List[Dict[str, Any]]:
  return repo.get_conversation_events(conversation_id)


@router.delete("/sessions/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_conversation(
  conversation_id: str,
  project_id: Optional[str] = Query(default=None),
  repo: ChatRepository = Depends(get_repository)
) -> Response:
  # Verify project_id if provided (security check)
  if project_id:
    summary = repo.get_conversation_summary(conversation_id)
    if not summary or summary.project_id != project_id:
      raise HTTPException(status_code=404, detail="Conversation not found")
  
  deleted = repo.delete_conversation(conversation_id)
  if not deleted:
    raise HTTPException(status_code=404, detail="Conversation not found")
  return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/settings", response_model=SettingsResponse)
def get_settings_api(repo: ChatRepository = Depends(get_repository)) -> SettingsResponse:
  settings_data = repo.get_settings()
  return SettingsResponse(**settings_data)


@router.put("/settings", response_model=SettingsResponse)
def update_settings_api(
  payload: UpdateSettingsRequest,
  repo: ChatRepository = Depends(get_repository),
) -> SettingsResponse:
  repo.update_settings(payload.model_dump(exclude_unset=True))
  settings_data = repo.get_settings()
  return SettingsResponse(**settings_data)
