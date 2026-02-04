"""Asset tools for the deep agent.

These tools allow the agent to:
1. Save analyses as reusable assets
2. Run saved analyses
3. Query freshness and lineage
4. List and search assets (analyses and file assets)
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import duckdb
from langchain_core.tools import StructuredTool

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.asset import (
    AssetService,
    get_asset_service,
    AssetNotFoundError,
    FileAssetService,
    get_file_asset_service,
    FilePreprocessingService,
    get_file_preprocessing_service,
    DiagnosisIssueService,
    get_diagnosis_issue_service,
)
from pluto_duck_backend.app.services.asset.errors import AssetValidationError

logger = logging.getLogger("pluto_duck_backend.agent.tools.asset")


def build_asset_tools(*, warehouse_path: Path, project_id: Optional[str] = None) -> List[StructuredTool]:
    """Build asset tools bound to a specific warehouse and project.
    
    Args:
        warehouse_path: Path to the DuckDB warehouse
        project_id: Project ID for asset isolation
    """
    print(f"[build_asset_tools] project_id={project_id}", flush=True)

    def _get_connection() -> duckdb.DuckDBPyConnection:
        return duckdb.connect(str(warehouse_path))

    # =========================================================================
    # Save / Create Analysis
    # =========================================================================

    def save_analysis(
        sql: str,
        name: str,
        description: Optional[str] = None,
        materialization: Literal["view", "table", "append", "parquet"] = "view",
        tags: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Save the current analysis as a reusable Asset in the Asset Library.

        ⚠️ IMPORTANT: This is the ONLY way to create views/tables that appear in the Asset Library.
        Do NOT use run_sql("CREATE VIEW ...") - those won't be tracked or visible to the user.

        Saved analyses can be:
        - Executed later with `run_analysis`
        - Referenced in Board dashboards
        - Tracked for freshness and lineage

        Args:
            sql: The SQL query to save
            name: Human-readable name (e.g., "월별 매출 분석")
            description: Optional description of what this analysis does
            materialization: How to store results:
                - "view": Virtual view (computed on-demand)
                - "table": Physical table (faster queries)
                - "append": Add new rows to existing table
                - "parquet": Export to Parquet file
            tags: Optional tags for organization (e.g., ["sales", "monthly"])

        Returns:
            Status and saved analysis details

        Example:
            save_analysis(
                sql="SELECT month, SUM(amount) FROM orders GROUP BY 1",
                name="월별 매출",
                materialization="table",
                tags=["sales", "reporting"]
            )
        """
        print(f"[save_analysis] Called with name={name}, project_id={project_id}", flush=True)
        service = get_asset_service(project_id)
        print(f"[save_analysis] AssetService project_id={service.project_id}", flush=True)

        try:
            analysis = service.create_analysis(
                sql=sql,
                name=name,
                description=description,
                materialization=materialization,
                tags=tags,
            )
            print(f"[save_analysis] Created analysis id={analysis.id}, project_id={service.project_id}", flush=True)

            return {
                "status": "success",
                "message": f"✅ '{name}' Asset이 저장되었어요. (ID: {analysis.id})",
                "analysis_id": analysis.id,
                "name": analysis.name,
                "materialization": analysis.materialize,
                "result_table": analysis.result_table,
                "hint": f"run_analysis('{analysis.id}')로 실행하거나 Registry에서 관리할 수 있어요.",
            }
        except AssetValidationError as e:
            print(f"[save_analysis] Validation error: {e}", flush=True)
            return {
                "status": "error",
                "message": f"❌ 저장 실패: {e}",
            }

    # =========================================================================
    # Run Analysis
    # =========================================================================

    def run_analysis(
        analysis_id: str,
        params: Optional[Dict[str, Any]] = None,
        force: bool = False,
    ) -> Dict[str, Any]:
        """Run a saved analysis.

        Args:
            analysis_id: ID of the analysis to run
            params: Parameter values if the analysis has parameters
            force: If True, run even if the result is still fresh

        Returns:
            Execution result with status and details

        Example:
            run_analysis("monthly_sales")
            run_analysis("cohort_analysis", params={"start_date": "2024-01-01"})
        """
        service = get_asset_service(project_id)

        with _get_connection() as conn:
            try:
                # Check freshness first
                if not force:
                    freshness = service.get_freshness(analysis_id, conn)
                    if not freshness.is_stale:
                        return {
                            "status": "skipped",
                            "message": f"ℹ️ '{analysis_id}'는 이미 최신 상태예요.",
                            "analysis_id": analysis_id,
                            "last_run_at": freshness.last_run_at.isoformat() if freshness.last_run_at else None,
                            "hint": "강제로 실행하려면 force=True를 사용하세요.",
                        }

                # Run the analysis
                result = service.run_analysis(analysis_id, conn, params=params, force=force)

                if result.success:
                    # Get last step result for summary
                    last_step = result.step_results[-1] if result.step_results else None

                    return {
                        "status": "success",
                        "message": f"✅ '{analysis_id}' 실행 완료!",
                        "analysis_id": analysis_id,
                        "steps_executed": len([s for s in result.step_results if s.status == "success"]),
                        "rows_affected": last_step.rows_affected if last_step else None,
                        "duration_ms": last_step.duration_ms if last_step else None,
                    }
                else:
                    # Find the failed step
                    failed_step = next((s for s in result.step_results if s.status == "failed"), None)

                    return {
                        "status": "error",
                        "message": f"❌ '{analysis_id}' 실행 실패",
                        "analysis_id": analysis_id,
                        "error": failed_step.error if failed_step else "Unknown error",
                    }

            except AssetNotFoundError:
                return {
                    "status": "error",
                    "message": f"❌ '{analysis_id}' Asset을 찾을 수 없어요.",
                    "hint": "list_analyses()로 사용 가능한 Asset 목록을 확인해보세요.",
                }

    # =========================================================================
    # List Analyses
    # =========================================================================

    def list_analyses(
        tags: Optional[List[str]] = None,
        show_freshness: bool = False,
    ) -> Dict[str, Any]:
        """List all saved analyses.

        Args:
            tags: Filter by tags (e.g., ["sales", "reporting"])
            show_freshness: Include freshness status for each analysis

        Returns:
            List of analyses with details
        """
        service = get_asset_service(project_id)
        analyses = service.list_analyses(tags)

        if not analyses:
            return {
                "status": "success",
                "message": "저장된 Analysis가 없어요.",
                "analyses": [],
            }

        result_list = []
        conn = None

        if show_freshness:
            conn = _get_connection()

        try:
            for a in analyses:
                item = {
                    "id": a.id,
                    "name": a.name,
                    "materialization": a.materialize,
                    "tags": a.tags or [],
                    "result_table": a.result_table,
                }

                if show_freshness and conn:
                    try:
                        freshness = service.get_freshness(a.id, conn)
                        item["is_stale"] = freshness.is_stale
                        item["last_run_at"] = freshness.last_run_at.isoformat() if freshness.last_run_at else None
                    except Exception:
                        item["is_stale"] = None

                result_list.append(item)
        finally:
            if conn:
                conn.close()

        return {
            "status": "success",
            "count": len(result_list),
            "analyses": result_list,
        }

    # =========================================================================
    # Get Analysis Details
    # =========================================================================

    def get_analysis(analysis_id: str) -> Dict[str, Any]:
        """Get details of a specific analysis.

        Args:
            analysis_id: ID of the analysis

        Returns:
            Analysis details including SQL, parameters, tags
        """
        service = get_asset_service(project_id)
        analysis = service.get_analysis(analysis_id)

        if not analysis:
            return {
                "status": "error",
                "message": f"❌ '{analysis_id}' Asset을 찾을 수 없어요.",
            }

        return {
            "status": "success",
            "id": analysis.id,
            "name": analysis.name,
            "sql": analysis.sql,
            "description": analysis.description,
            "materialization": analysis.materialize,
            "parameters": [
                {
                    "name": p.name,
                    "type": p.type,
                    "required": p.required,
                    "default": p.default,
                }
                for p in (analysis.parameters or [])
            ],
            "tags": analysis.tags or [],
            "result_table": analysis.result_table,
            "created_at": analysis.created_at.isoformat() if analysis.created_at else None,
            "updated_at": analysis.updated_at.isoformat() if analysis.updated_at else None,
        }

    # =========================================================================
    # Get Lineage
    # =========================================================================

    def get_lineage(analysis_id: str) -> Dict[str, Any]:
        """Get data lineage for an analysis.

        Shows what data sources the analysis depends on (upstream)
        and what other analyses depend on it (downstream).

        Args:
            analysis_id: ID of the analysis

        Returns:
            Lineage information with upstream and downstream dependencies
        """
        service = get_asset_service(project_id)

        try:
            lineage = service.get_lineage(analysis_id)

            return {
                "status": "success",
                "analysis_id": analysis_id,
                "upstream": lineage.upstream,
                "downstream": lineage.downstream,
            }
        except AssetNotFoundError:
            return {
                "status": "error",
                "message": f"❌ '{analysis_id}' Asset을 찾을 수 없어요.",
            }

    # =========================================================================
    # Get Freshness
    # =========================================================================

    def get_freshness(analysis_id: str) -> Dict[str, Any]:
        """Check if an analysis needs to be re-run.

        Args:
            analysis_id: ID of the analysis

        Returns:
            Freshness status with is_stale flag and details
        """
        service = get_asset_service(project_id)

        with _get_connection() as conn:
            try:
                freshness = service.get_freshness(analysis_id, conn)

                status_emoji = "🟢" if not freshness.is_stale else "🟡"

                return {
                    "status": "success",
                    "analysis_id": analysis_id,
                    "is_stale": freshness.is_stale,
                    "display": f"{status_emoji} {'Stale' if freshness.is_stale else 'Fresh'}",
                    "last_run_at": freshness.last_run_at.isoformat() if freshness.last_run_at else None,
                    "stale_reason": freshness.stale_reason,
                }
            except AssetNotFoundError:
                return {
                    "status": "error",
                    "message": f"❌ '{analysis_id}' Asset을 찾을 수 없어요.",
                }

    # =========================================================================
    # Delete Analysis
    # =========================================================================

    def delete_analysis(analysis_id: str) -> Dict[str, Any]:
        """Delete a saved analysis.

        Args:
            analysis_id: ID of the analysis to delete

        Returns:
            Status message
        """
        service = get_asset_service(project_id)

        if service.delete_analysis(analysis_id):
            return {
                "status": "success",
                "message": f"✅ '{analysis_id}' Asset을 삭제했어요.",
            }

        return {
            "status": "error",
            "message": f"❌ '{analysis_id}' Asset을 찾을 수 없어요.",
        }

    # =========================================================================
    # List File Assets (CSV/Parquet)
    # =========================================================================

    def list_files() -> Dict[str, Any]:
        """List all imported file assets (CSV/Parquet).

        File assets are imported via the UI and stored as DuckDB tables.
        Use this to discover what file data is available for analysis.

        Returns:
            List of file assets with table names and metadata

        Example:
            files = list_files()
            # Returns: {"files": [{"name": "고객 데이터", "table_name": "customers", ...}]}
            # Then query: run_sql("SELECT * FROM customers")
        """
        file_service = get_file_asset_service(project_id)
        files = file_service.list_files()

        if not files:
            return {
                "status": "success",
                "message": "임포트된 파일이 없어요.",
                "files": [],
            }

        file_list = [
            {
                "id": f.id,
                "name": f.name,
                "table_name": f.table_name,
                "file_type": f.file_type,
                "row_count": f.row_count,
                "column_count": f.column_count,
                "description": f.description,
                "created_at": f.created_at.isoformat() if f.created_at else None,
            }
            for f in files
        ]

        return {
            "status": "success",
            "count": len(file_list),
            "files": file_list,
            "hint": "run_sql('SELECT * FROM {table_name}')로 데이터를 조회할 수 있어요.",
        }

    # =========================================================================
    # Dataset Readiness (Preprocessing)
    # =========================================================================

    def get_readiness_summary() -> Dict[str, Any]:
        """Summarize preprocessing readiness for all file assets.

        Returns:
            Total datasets, ready count, not-ready count, and details for non-ready files.
        """
        file_service: FileAssetService = get_file_asset_service(project_id)
        preprocessing_service: FilePreprocessingService = get_file_preprocessing_service(project_id)
        assets = file_service.list_files()

        total = len(assets)
        ready_count = 0
        not_ready: List[Dict[str, Any]] = []

        for asset in assets:
            effective = preprocessing_service.get_effective_status(
                file_asset_id=asset.id,
                current_diagnosis_id=asset.diagnosis_id,
            )
            if effective.status == "ready":
                ready_count += 1
                continue

            name = asset.name or asset.table_name or asset.file_path or asset.id
            not_ready.append(
                {
                    "file_asset_id": asset.id,
                    "name": name,
                    "status": effective.status,
                    "stale": effective.stale,
                    "reason": effective.reason,
                    "last_diagnosis_id": effective.last_diagnosis_id,
                }
            )

        return {
            "status": "success",
            "total": total,
            "ready_count": ready_count,
            "not_ready_count": total - ready_count,
            "not_ready": not_ready,
        }

    def list_not_ready(include_unknown: bool = True) -> Dict[str, Any]:
        """List file assets that are not ready for analysis.

        Args:
            include_unknown: If True, include 'unknown' statuses; otherwise only 'not_ready'.
        """
        file_service: FileAssetService = get_file_asset_service(project_id)
        preprocessing_service: FilePreprocessingService = get_file_preprocessing_service(project_id)
        assets = file_service.list_files()

        not_ready: List[Dict[str, Any]] = []
        for asset in assets:
            effective = preprocessing_service.get_effective_status(
                file_asset_id=asset.id,
                current_diagnosis_id=asset.diagnosis_id,
            )
            if effective.status == "ready":
                continue
            if effective.status == "unknown" and not include_unknown:
                continue

            name = asset.name or asset.table_name or asset.file_path or asset.id
            not_ready.append(
                {
                    "file_asset_id": asset.id,
                    "name": name,
                    "status": effective.status,
                    "stale": effective.stale,
                    "reason": effective.reason,
                    "last_diagnosis_id": effective.last_diagnosis_id,
                }
            )

        return {
            "status": "success",
            "count": len(not_ready),
            "not_ready": not_ready,
        }

    def set_readiness_status(
        file_asset_id: str,
        status: Literal["unknown", "not_ready", "ready"],
        reason: Optional[str] = None,
        actor: Optional[str] = None,
        last_diagnosis_id: Optional[str] = None,
        event_type: Optional[str] = None,
        event_message: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Update preprocessing readiness status for a file asset.

        Args:
            file_asset_id: File asset ID
            status: new status (unknown|not_ready|ready)
            reason: optional explanation
            actor: who updated the status
            last_diagnosis_id: attach to current diagnosis if omitted
            event_type: optional event type to log
            event_message: optional event message to log
        """
        file_service: FileAssetService = get_file_asset_service(project_id)
        preprocessing_service: FilePreprocessingService = get_file_preprocessing_service(project_id)

        if last_diagnosis_id is None:
            asset = file_service.get_file(file_asset_id)
            last_diagnosis_id = asset.diagnosis_id if asset else None

        status_obj = preprocessing_service.set_status(
            file_asset_id=file_asset_id,
            status=status,
            reason=reason,
            actor=actor,
            last_diagnosis_id=last_diagnosis_id,
        )

        event = None
        if event_type:
            event = preprocessing_service.append_event(
                file_asset_id=file_asset_id,
                event_type=event_type,
                message=event_message,
                actor=actor,
            )

        return {
            "status": "success",
            "readiness": status_obj.to_dict(),
            "event": event.to_dict() if event else None,
        }

    def append_preprocessing_event(
        file_asset_id: str,
        event_type: str,
        message: Optional[str] = None,
        actor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Append a preprocessing event for a file asset."""
        preprocessing_service: FilePreprocessingService = get_file_preprocessing_service(project_id)
        event = preprocessing_service.append_event(
            file_asset_id=file_asset_id,
            event_type=event_type,
            message=message,
            actor=actor,
        )
        return {
            "status": "success",
            "event": event.to_dict(),
        }

    # =========================================================================
    # Diagnosis Issues
    # =========================================================================

    def list_diagnosis_issues(
        file_asset_id: str,
        status: Optional[str] = None,
        include_deleted: bool = False,
    ) -> Dict[str, Any]:
        """List diagnosis issues for a file asset."""
        issue_service: DiagnosisIssueService = get_diagnosis_issue_service(project_id)
        issues = issue_service.list_issues(
            file_asset_id=file_asset_id,
            include_deleted=include_deleted,
            status=status,
        )
        return {
            "status": "success",
            "count": len(issues),
            "issues": [issue.to_dict() for issue in issues],
        }

    def set_issue_status(
        issue_id: str,
        status: Optional[str] = None,
        user_response: Optional[str] = None,
        resolved_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Update a diagnosis issue status/user_response."""
        issue_service: DiagnosisIssueService = get_diagnosis_issue_service(project_id)
        updated = issue_service.update_issue(
            issue_id=issue_id,
            status=status,
            user_response=user_response,
            resolved_by=resolved_by,
        )
        if not updated:
            return {
                "status": "error",
                "message": "Issue not found.",
            }
        return {
            "status": "success",
            "issue": updated.to_dict(),
        }

    # =========================================================================
    # Build Tool List
    # =========================================================================

    return [
        StructuredTool.from_function(
            name="save_analysis",
            func=save_analysis,
            description=(
                "현재 분석을 재사용 가능한 Asset으로 저장합니다. "
                "저장된 Asset은 나중에 실행하거나 Board에 추가할 수 있어요."
            ),
        ),
        StructuredTool.from_function(
            name="run_analysis",
            func=run_analysis,
            description=(
                "저장된 Analysis를 실행합니다. "
                "이미 최신 상태면 건너뛰고, force=True로 강제 실행할 수 있어요."
            ),
        ),
        StructuredTool.from_function(
            name="list_analyses",
            func=list_analyses,
            description="저장된 Analysis 목록을 조회합니다. 태그로 필터링할 수 있어요.",
        ),
        StructuredTool.from_function(
            name="get_analysis",
            func=get_analysis,
            description="특정 Analysis의 상세 정보 (SQL, 파라미터, 태그 등)를 조회합니다.",
        ),
        StructuredTool.from_function(
            name="get_lineage",
            func=get_lineage,
            description=(
                "Analysis의 데이터 계보(Lineage)를 조회합니다. "
                "어떤 데이터에 의존하고 어떤 분석에 영향을 주는지 확인할 수 있어요."
            ),
        ),
        StructuredTool.from_function(
            name="get_freshness",
            func=get_freshness,
            description="Analysis가 최신 상태인지 확인합니다. Stale이면 재실행이 필요해요.",
        ),
        StructuredTool.from_function(
            name="delete_analysis",
            func=delete_analysis,
            description="저장된 Analysis를 삭제합니다.",
        ),
        # File Asset tools
        StructuredTool.from_function(
            name="list_files",
            func=list_files,
            description=(
                "임포트된 파일(CSV/Parquet) 목록을 조회합니다. "
                "파일이 어떤 테이블로 저장되었는지 확인하고 run_sql로 쿼리할 수 있어요."
            ),
        ),
        # Readiness tools
        StructuredTool.from_function(
            name="get_readiness_summary",
            func=get_readiness_summary,
            description="파일 데이터셋의 전처리 준비 상태 요약을 조회합니다.",
        ),
        StructuredTool.from_function(
            name="list_not_ready",
            func=list_not_ready,
            description="분석 준비가 되지 않은 파일 데이터셋 목록을 조회합니다.",
        ),
        StructuredTool.from_function(
            name="set_readiness_status",
            func=set_readiness_status,
            description="파일 데이터셋의 전처리 준비 상태를 업데이트합니다.",
        ),
        StructuredTool.from_function(
            name="append_preprocessing_event",
            func=append_preprocessing_event,
            description="전처리 관련 이벤트 로그를 추가합니다.",
        ),
        # Diagnosis issue tools
        StructuredTool.from_function(
            name="list_diagnosis_issues",
            func=list_diagnosis_issues,
            description="파일 진단 이슈 목록을 조회합니다.",
        ),
        StructuredTool.from_function(
            name="set_issue_status",
            func=set_issue_status,
            description="진단 이슈 상태/응답을 업데이트합니다.",
        ),
    ]
