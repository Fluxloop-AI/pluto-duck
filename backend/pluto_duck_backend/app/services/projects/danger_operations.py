"""Project-scoped destructive operations and confirmation phrase utilities."""

from __future__ import annotations

import logging
import re
import shutil
from typing import Any, Literal, cast

from pluto_duck_backend.app.core.config import get_settings as get_app_settings
from pluto_duck_backend.app.services.asset import (
    get_diagnosis_issue_service,
    get_file_asset_service,
    get_file_diagnosis_service,
)
from pluto_duck_backend.app.services.chat import get_chat_repository
from pluto_duck_backend.app.services.projects.analysis_ownership import (
    resolve_owned_and_shared_analysis_ids,
)
from pluto_duck_backend.app.services.source import get_source_service
from pluto_duck_backend.app.services.workzone import get_work_zone_service

logger = logging.getLogger(__name__)

DangerOperation = Literal["reset", "delete"]


def slugify_project_name(project_name: str) -> str:
    """Build a stable slug from a project name for confirmation phrases."""
    slug = re.sub(r"[^a-z0-9]+", "-", project_name.lower()).strip("-")
    return slug or "project"


def expected_confirmation_phrase(project_name: str, operation: DangerOperation) -> str:
    """Return the expected confirmation phrase for a destructive action."""
    project_slug = slugify_project_name(project_name)
    if operation == "reset":
        return f"reset-{project_slug}"
    return f"delete-{project_slug}-permanently"


def _quote_identifier(name: str) -> str:
    """Quote a SQL identifier safely for DuckDB."""
    escaped = name.replace('"', '""')
    return f'"{escaped}"'


def reset_project_data(project_id: str) -> str:
    """Reset project-scoped data while keeping the project row."""
    logger.warning("Project data reset requested. Project: %s", project_id)

    settings = get_app_settings()
    repo = get_chat_repository()

    # Gather analysis IDs before deleting analysis files.
    analyses_root = settings.duckdb.path.parent / "analyses"
    analyses_dir = analyses_root / project_id
    owned_analysis_ids, shared_analysis_ids = resolve_owned_and_shared_analysis_ids(
        project_id=project_id,
        analyses_root=analyses_root,
    )

    # Gather conversation IDs to clean up runtime work zones.
    with repo._connect() as con:
        conversation_ids = [
            row[0]
            for row in con.execute(
                "SELECT id FROM agent_conversations WHERE project_id = ?",
                [project_id],
            ).fetchall()
        ]

    # Delete file assets (and their tables) for this project.
    file_service = get_file_asset_service(project_id)
    assets = file_service.list_files()
    shared_table_names: set[str] = set()
    if assets:
        candidate_table_names = sorted(
            {
                asset.table_name
                for asset in assets
                if asset.table_name
            }
        )
        if candidate_table_names:
            placeholders = ", ".join(["?"] * len(candidate_table_names))
            with repo._connect() as con:
                rows = con.execute(
                    f"""
                    SELECT DISTINCT table_name
                    FROM _file_assets.files
                    WHERE project_id <> ?
                      AND table_name IN ({placeholders})
                    """,
                    [project_id, *candidate_table_names],
                ).fetchall()
                shared_table_names = {
                    str(row[0])
                    for row in rows
                    if row and row[0]
                }
    for asset in assets:
        drop_table = asset.table_name not in shared_table_names
        if not drop_table:
            logger.warning(
                "Project reset: skipping table drop for shared table '%s' (project_id=%s)",
                asset.table_name,
                project_id,
            )
        file_service.delete_file(asset.id, drop_table=drop_table)

    # Clear cached diagnoses for this project.
    diagnosis_service = get_file_diagnosis_service(project_id)
    diagnosis_service.delete_all()

    # Clear diagnosis issues for this project.
    issue_service = get_diagnosis_issue_service(project_id)
    issue_service.delete_all()

    # Drop cached tables in the project's warehouse.
    source_service = get_source_service(project_id)
    cached_tables = source_service.list_cached_tables()
    for cached in cached_tables:
        source_service.drop_cache(cached.local_table)

    # Clear board data, chats, and project-scoped metadata from main warehouse.
    with repo._write_connection() as connection:
        con = cast(Any, connection)
        # Boards
        con.execute(
            """
            DELETE FROM board_item_assets
            WHERE board_item_id IN (
                SELECT id FROM board_items
                WHERE board_id IN (SELECT id FROM boards WHERE project_id = ?)
            )
            """,
            [project_id],
        )
        con.execute(
            """
            DELETE FROM board_queries
            WHERE board_item_id IN (
                SELECT id FROM board_items
                WHERE board_id IN (SELECT id FROM boards WHERE project_id = ?)
            )
            """,
            [project_id],
        )
        con.execute(
            """
            DELETE FROM board_items
            WHERE board_id IN (SELECT id FROM boards WHERE project_id = ?)
            """,
            [project_id],
        )
        con.execute("DELETE FROM boards WHERE project_id = ?", [project_id])

        # Conversations + related artifacts
        con.execute(
            """
            DELETE FROM agent_tool_approvals
            WHERE conversation_id IN (
                SELECT id FROM agent_conversations WHERE project_id = ?
            )
            """,
            [project_id],
        )
        con.execute(
            """
            DELETE FROM agent_checkpoints
            WHERE run_id IN (
                SELECT run_id
                FROM agent_messages
                WHERE conversation_id IN (
                    SELECT id FROM agent_conversations WHERE project_id = ?
                )
                AND run_id IS NOT NULL
                UNION
                SELECT run_id
                FROM agent_conversations
                WHERE project_id = ?
                AND run_id IS NOT NULL
            )
            """,
            [project_id, project_id],
        )
        con.execute(
            """
            DELETE FROM agent_events
            WHERE conversation_id IN (
                SELECT id FROM agent_conversations WHERE project_id = ?
            )
            """,
            [project_id],
        )
        con.execute(
            """
            DELETE FROM agent_messages
            WHERE conversation_id IN (
                SELECT id FROM agent_conversations WHERE project_id = ?
            )
            """,
            [project_id],
        )
        con.execute("DELETE FROM agent_conversations WHERE project_id = ?", [project_id])

        # Data sources metadata
        con.execute(
            """
            DELETE FROM data_source_tables
            WHERE data_source_id IN (
                SELECT id FROM data_sources WHERE project_id = ?
            )
            """,
            [project_id],
        )
        con.execute("DELETE FROM data_sources WHERE project_id = ?", [project_id])

        # Duckpipe run history/state for this project's analyses.
        # Shared IDs are skipped to avoid cross-project data loss.
        if owned_analysis_ids:
            placeholders = ", ".join(["?"] * len(owned_analysis_ids))
            con.execute(
                f"DELETE FROM _duckpipe.run_history WHERE analysis_id IN ({placeholders})",
                owned_analysis_ids,
            )
            con.execute(
                f"DELETE FROM _duckpipe.run_state WHERE analysis_id IN ({placeholders})",
                owned_analysis_ids,
            )
        for analysis_id in owned_analysis_ids:
            safe_id = _quote_identifier(analysis_id)
            try:
                con.execute(f"DROP VIEW IF EXISTS analysis.{safe_id}")
            except Exception:
                pass
            try:
                con.execute(f"DROP TABLE IF EXISTS analysis.{safe_id}")
            except Exception:
                pass
        for analysis_id in shared_analysis_ids:
            logger.warning(
                "Project reset: skipping shared analysis cleanup for id='%s' (project_id=%s)",
                analysis_id,
                project_id,
            )

        # Reset project settings metadata
        con.execute(
            "UPDATE projects SET settings = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [project_id],
        )

    # Remove per-conversation work zones.
    if conversation_ids:
        workzone_service = get_work_zone_service()
        for conv_id in conversation_ids:
            workzone_service.delete(conv_id)

    # Remove project-specific warehouse file (cached tables, attached sources, etc.).
    project_dir = settings.data_dir.root / "data" / "projects" / project_id
    if project_dir.exists():
        shutil.rmtree(project_dir)

    # Clear cached SourceService instances so future requests reinitialize safely.
    try:
        get_source_service.cache_clear()
    except Exception:
        pass

    # Remove analysis definitions for this project.
    if analyses_dir.exists():
        shutil.rmtree(analyses_dir)

    return "Project data reset successfully. All project data and metadata have been cleared."
