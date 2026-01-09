"""Asset tools for the deep agent.

These tools allow the agent to:
1. Save analyses as reusable assets
2. Run saved analyses
3. Query freshness and lineage
4. List and search assets
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import duckdb
from langchain_core.tools import StructuredTool

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.asset import (
    AssetService,
    get_asset_service,
    AssetNotFoundError,
)
from pluto_duck_backend.app.services.asset.errors import AssetValidationError


def build_asset_tools(*, warehouse_path: Path) -> List[StructuredTool]:
    """Build asset tools bound to a specific warehouse."""

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
        """Save the current analysis as a reusable Asset.

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
        service = get_asset_service()

        try:
            analysis = service.create_analysis(
                sql=sql,
                name=name,
                description=description,
                materialization=materialization,
                tags=tags,
            )

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
        service = get_asset_service()

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
        service = get_asset_service()
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
        service = get_asset_service()
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
        service = get_asset_service()

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
        service = get_asset_service()

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
        service = get_asset_service()

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
    ]

