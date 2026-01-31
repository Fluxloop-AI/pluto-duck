"""Asset Diagnosis API Router - File diagnosis endpoints."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from pluto_duck_backend.app.api.deps import get_project_id_query
from pluto_duck_backend.app.api.v1.asset.diagnosis.schemas import (
    CategoricalStatsResponse,
    ColumnSchemaResponse,
    ColumnStatisticsResponse,
    CountDuplicatesRequest,
    CountDuplicatesResponse,
    DiagnosisIssueDeleteRequest,
    DiagnosisIssueListResponse,
    DiagnosisIssueResponse,
    DiagnosisIssueUpdateRequest,
    DateStatsResponse,
    DiagnoseFilesRequest,
    DiagnoseFilesResponse,
    EncodingInfoResponse,
    FileDiagnosisResponse,
    IssueItemResponse,
    LLMAnalysisResponse,
    MergedAnalysisResponse,
    NumericStatsResponse,
    ParsingIntegrityResponse,
    PotentialItemResponse,
    TypeSuggestionResponse,
    ValueFrequencyResponse,
)
from pluto_duck_backend.app.services.asset import (
    DiagnosisIssue,
    DiagnosisIssueService,
    FileAssetService,
    FileDiagnosisService,
    get_diagnosis_issue_service,
    get_file_asset_service,
    get_file_diagnosis_service,
)
from pluto_duck_backend.app.services.asset.errors import DiagnosisError

logger = logging.getLogger(__name__)


router = APIRouter()


def _issue_to_response(issue: DiagnosisIssue) -> DiagnosisIssueResponse:
    return DiagnosisIssueResponse(
        id=issue.id,
        diagnosis_id=issue.diagnosis_id,
        file_asset_id=issue.file_asset_id,
        issue=issue.issue,
        issue_type=issue.issue_type,
        suggestion=issue.suggestion,
        example=issue.example,
        status=issue.status,
        user_response=issue.user_response,
        confirmed_at=issue.confirmed_at,
        resolved_at=issue.resolved_at,
        resolved_by=issue.resolved_by,
        deleted_at=issue.deleted_at,
        deleted_by=issue.deleted_by,
        delete_reason=issue.delete_reason,
        created_at=issue.created_at,
        updated_at=issue.updated_at,
    )


def _diagnosis_to_response(diagnosis) -> FileDiagnosisResponse:
    return FileDiagnosisResponse(
        file_path=diagnosis.file_path,
        file_type=diagnosis.file_type,
        columns=[
            ColumnSchemaResponse(
                name=col.name,
                type=col.type,
                nullable=col.nullable,
            )
            for col in diagnosis.schema
        ],
        missing_values=diagnosis.missing_values,
        row_count=diagnosis.row_count,
        file_size_bytes=diagnosis.file_size_bytes,
        type_suggestions=[
            TypeSuggestionResponse(
                column_name=ts.column_name,
                current_type=ts.current_type,
                suggested_type=ts.suggested_type,
                confidence=ts.confidence,
                sample_values=ts.sample_values,
            )
            for ts in diagnosis.type_suggestions
        ],
        diagnosed_at=diagnosis.diagnosed_at,
        encoding=EncodingInfoResponse(
            detected=diagnosis.encoding.detected,
            confidence=diagnosis.encoding.confidence,
        ) if diagnosis.encoding else None,
        parsing_integrity=ParsingIntegrityResponse(
            total_lines=diagnosis.parsing_integrity.total_lines,
            parsed_rows=diagnosis.parsing_integrity.parsed_rows,
            malformed_rows=diagnosis.parsing_integrity.malformed_rows,
            has_errors=diagnosis.parsing_integrity.has_errors,
            error_message=diagnosis.parsing_integrity.error_message,
        ) if diagnosis.parsing_integrity else None,
        column_statistics=[
            ColumnStatisticsResponse(
                column_name=cs.column_name,
                column_type=cs.column_type,
                semantic_type=cs.semantic_type,
                null_count=cs.null_count,
                null_percentage=cs.null_percentage,
                numeric_stats=NumericStatsResponse(
                    min=cs.numeric_stats.min,
                    max=cs.numeric_stats.max,
                    median=cs.numeric_stats.median,
                    mean=cs.numeric_stats.mean,
                    stddev=cs.numeric_stats.stddev,
                    distinct_count=cs.numeric_stats.distinct_count,
                ) if cs.numeric_stats else None,
                categorical_stats=CategoricalStatsResponse(
                    unique_count=cs.categorical_stats.unique_count,
                    top_values=[
                        ValueFrequencyResponse(
                            value=vf.value,
                            frequency=vf.frequency,
                        )
                        for vf in cs.categorical_stats.top_values
                    ],
                    avg_length=cs.categorical_stats.avg_length,
                ) if cs.categorical_stats else None,
                date_stats=DateStatsResponse(
                    min_date=cs.date_stats.min_date,
                    max_date=cs.date_stats.max_date,
                    span_days=cs.date_stats.span_days,
                    distinct_days=cs.date_stats.distinct_days,
                ) if cs.date_stats else None,
            )
            for cs in diagnosis.column_statistics
        ],
        sample_rows=diagnosis.sample_rows,
        llm_analysis=LLMAnalysisResponse(
            suggested_name=diagnosis.llm_analysis.suggested_name,
            context=diagnosis.llm_analysis.context,
            potential=[
                PotentialItemResponse(
                    question=p.question,
                    analysis=p.analysis,
                )
                for p in diagnosis.llm_analysis.potential
            ],
            issues=[
                IssueItemResponse(
                    issue=i.issue,
                    issue_type=i.issue_type,
                    suggestion=i.suggestion,
                    example=i.example,
                )
                for i in diagnosis.llm_analysis.issues
            ],
            analyzed_at=diagnosis.llm_analysis.analyzed_at,
            model_used=diagnosis.llm_analysis.model_used,
        ) if diagnosis.llm_analysis else None,
        diagnosis_id=diagnosis.diagnosis_id,
    )


# =============================================================================
# Dependency helpers
# =============================================================================


def get_file_diagnosis_service_dep(
    project_id: Optional[str] = Depends(get_project_id_query),
) -> FileDiagnosisService:
    """Provide a FileDiagnosisService scoped to the project."""
    return get_file_diagnosis_service(project_id)


def get_file_asset_service_dep(
    project_id: Optional[str] = Depends(get_project_id_query),
) -> FileAssetService:
    """Provide a FileAssetService scoped to the project."""
    return get_file_asset_service(project_id)


def get_diagnosis_issue_service_dep(
    project_id: Optional[str] = Depends(get_project_id_query),
) -> DiagnosisIssueService:
    """Provide a DiagnosisIssueService scoped to the project."""
    return get_diagnosis_issue_service(project_id)


# =============================================================================
# File Diagnosis Endpoints
# =============================================================================


@router.post("/count-duplicates", response_model=CountDuplicatesResponse)
def count_duplicate_rows(
    request: CountDuplicatesRequest,
    service: FileDiagnosisService = Depends(get_file_diagnosis_service_dep),
) -> CountDuplicatesResponse:
    """Count duplicate rows across multiple files.

    This endpoint calculates the number of duplicate rows when merging files,
    allowing users to preview deduplication results before import.

    If total rows exceed 100,000, calculation is skipped and skipped=true is returned.
    """
    from pluto_duck_backend.app.services.asset.file_diagnosis_service import DiagnoseFileRequest

    # Convert request to DiagnoseFileRequest objects
    file_requests = [
        DiagnoseFileRequest(file_path=f.file_path, file_type=f.file_type)
        for f in request.files
    ]

    try:
        result = service.count_cross_file_duplicates(files=file_requests)
        return CountDuplicatesResponse(
            total_rows=result["total_rows"],
            duplicate_rows=result["duplicate_rows"],
            estimated_rows=result["estimated_rows"],
            skipped=result["skipped"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to count duplicates: {e}")


@router.post("/diagnose", response_model=DiagnoseFilesResponse)
async def diagnose_files(
    request: DiagnoseFilesRequest,
    service: FileDiagnosisService = Depends(get_file_diagnosis_service_dep),
) -> DiagnoseFilesResponse:
    """Diagnose CSV or Parquet files before import.

    This endpoint analyzes files without importing them, providing:
    - Schema information (columns, types, nullable)
    - Missing value counts per column
    - Row count and file size
    - Type suggestions (optional, for detecting mismatched types)
    - LLM-generated analysis (when include_llm=true)
    - Merged dataset analysis (when include_merge_analysis=true with merge_context)

    Use this to preview data quality before creating tables.

    Set use_cache=false to force fresh diagnosis even if cached results exist.
    Set include_llm=true to include LLM-generated analysis (slower).
    Set include_merge_analysis=true with merge_context to get merged dataset name suggestion.
    """
    from pluto_duck_backend.app.services.asset.file_diagnosis_service import DiagnoseFileRequest

    # Convert request to DiagnoseFileRequest objects
    file_requests = [
        DiagnoseFileRequest(file_path=f.file_path, file_type=f.file_type)
        for f in request.files
    ]

    # Prepare merge_context dict if provided
    merge_context_dict = None
    if request.include_merge_analysis and request.merge_context:
        merge_context_dict = {
            "total_rows": request.merge_context.total_rows,
            "duplicate_rows": request.merge_context.duplicate_rows,
            "estimated_rows": request.merge_context.estimated_rows,
            "skipped": request.merge_context.skipped,
        }

    # Run diagnosis (with or without LLM analysis based on include_llm flag)
    merged_analysis_response: Optional[MergedAnalysisResponse] = None
    llm_pending = False

    async def run_llm_background(
        diagnoses,
        new_diagnoses,
        llm_cache_key: str,
        merge_context: Optional[dict],
    ) -> None:
        try:
            from pluto_duck_backend.app.services.asset.file_diagnosis_service import MergedAnalysis
            from pluto_duck_backend.app.services.asset.llm_analysis_service import (
                MergeContext as LLMMergeContext,
                analyze_datasets_with_llm,
            )

            llm_merge_context = None
            if merge_context is not None:
                llm_merge_context = LLMMergeContext(
                    schemas_identical=True,  # API only sends merge_context when schemas match
                    total_files=len(file_requests),
                    total_rows=merge_context.get("total_rows", 0),
                    duplicate_rows=merge_context.get("duplicate_rows", 0),
                    estimated_rows_after_dedup=merge_context.get("estimated_rows", 0),
                    skipped=merge_context.get("skipped", False),
                )

            diagnoses_for_llm = diagnoses if llm_merge_context is not None else new_diagnoses
            if not diagnoses_for_llm:
                return

            batch_result = await analyze_datasets_with_llm(
                diagnoses_for_llm,
                merge_context=llm_merge_context,
            )

            # Save LLM results for newly analyzed files (or cache without LLM on failure)
            for diagnosis in new_diagnoses:
                if diagnosis.file_path in batch_result.file_results:
                    diagnosis.llm_analysis = batch_result.file_results[diagnosis.file_path]
                service.save_diagnosis(diagnosis)

            # Cache merged analysis if present
            if llm_merge_context is not None and batch_result.merged_result is not None:
                service.set_cached_merged_analysis(
                    llm_cache_key,
                    MergedAnalysis(
                        suggested_name=batch_result.merged_result.suggested_name,
                        context=batch_result.merged_result.context,
                    ),
                )
        except Exception as e:
            logger.error(f"LLM background analysis failed: {e}", exc_info=True)
        finally:
            service.clear_llm_inflight(llm_cache_key)

    try:
        if request.include_llm:
            llm_mode = request.llm_mode
            if llm_mode == "sync":
                # Include LLM analysis (slower)
                diagnosis_result = await service.diagnose_files_with_llm(
                    files=file_requests,
                    use_cache=request.use_cache,
                    merge_context=merge_context_dict,
                )
                all_diagnoses = diagnosis_result.diagnoses
                # Extract merged analysis if present
                if diagnosis_result.merged_analysis:
                    merged_analysis_response = MergedAnalysisResponse(
                        suggested_name=diagnosis_result.merged_analysis.suggested_name,
                        context=diagnosis_result.merged_analysis.context,
                    )
            else:
                all_diagnoses = []
                new_diagnoses = []
                for file_req in file_requests:
                    diagnosis = None
                    cached = None
                    if request.use_cache:
                        cached = service.get_cached_diagnosis(file_req.file_path)
                        if cached:
                            diagnosis = cached

                    if diagnosis is None:
                        diagnosis = service.diagnose_file(file_req.file_path, file_req.file_type)

                    # Attach cached LLM analysis when available
                    if cached and cached.llm_analysis:
                        diagnosis.llm_analysis = cached.llm_analysis
                        diagnosis.diagnosis_id = cached.diagnosis_id

                    if diagnosis.llm_analysis is None:
                        new_diagnoses.append(diagnosis)
                    all_diagnoses.append(diagnosis)

                llm_cache_key: Optional[str] = None
                if request.include_merge_analysis and merge_context_dict is not None:
                    llm_cache_key = service.build_llm_cache_key(
                        file_requests,
                        merge_context_dict,
                    )
                    cached_merged = service.get_cached_merged_analysis(llm_cache_key)
                    if cached_merged:
                        merged_analysis_response = MergedAnalysisResponse(
                            suggested_name=cached_merged.suggested_name,
                            context=cached_merged.context,
                        )

                llm_pending = (
                    len(new_diagnoses) > 0
                    or (
                        request.include_merge_analysis
                        and merge_context_dict is not None
                        and merged_analysis_response is None
                    )
                )

                if llm_mode == "defer" and llm_pending:
                    if llm_cache_key is None:
                        llm_cache_key = service.build_llm_cache_key(
                            file_requests,
                            merge_context_dict,
                        )
                    if service.mark_llm_inflight(llm_cache_key):
                        asyncio.create_task(
                            run_llm_background(
                                all_diagnoses,
                                new_diagnoses,
                                llm_cache_key,
                                merge_context_dict,
                            )
                        )
        else:
            # Technical diagnosis only (fast)
            all_diagnoses = service.diagnose_files(files=file_requests)
    except DiagnosisError as e:
        error_message = str(e)
        if "File not found" in error_message:
            raise HTTPException(status_code=404, detail=error_message)
        raise HTTPException(status_code=500, detail=f"Diagnosis failed: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Diagnosis failed: {e}")

    # Build response objects
    diagnoses = []
    for diagnosis in all_diagnoses:
        diagnoses.append(
            FileDiagnosisResponse(
                file_path=diagnosis.file_path,
                file_type=diagnosis.file_type,
                columns=[
                    ColumnSchemaResponse(
                        name=col.name,
                        type=col.type,
                        nullable=col.nullable,
                    )
                    for col in diagnosis.schema
                ],
                missing_values=diagnosis.missing_values,
                row_count=diagnosis.row_count,
                file_size_bytes=diagnosis.file_size_bytes,
                type_suggestions=[
                    TypeSuggestionResponse(
                        column_name=ts.column_name,
                        current_type=ts.current_type,
                        suggested_type=ts.suggested_type,
                        confidence=ts.confidence,
                        sample_values=ts.sample_values,
                    )
                    for ts in diagnosis.type_suggestions
                ],
                diagnosed_at=diagnosis.diagnosed_at,
                # Extended diagnosis fields
                encoding=EncodingInfoResponse(
                    detected=diagnosis.encoding.detected,
                    confidence=diagnosis.encoding.confidence,
                ) if diagnosis.encoding else None,
                parsing_integrity=ParsingIntegrityResponse(
                    total_lines=diagnosis.parsing_integrity.total_lines,
                    parsed_rows=diagnosis.parsing_integrity.parsed_rows,
                    malformed_rows=diagnosis.parsing_integrity.malformed_rows,
                    has_errors=diagnosis.parsing_integrity.has_errors,
                    error_message=diagnosis.parsing_integrity.error_message,
                ) if diagnosis.parsing_integrity else None,
                column_statistics=[
                    ColumnStatisticsResponse(
                        column_name=cs.column_name,
                        column_type=cs.column_type,
                        semantic_type=cs.semantic_type,
                        null_count=cs.null_count,
                        null_percentage=cs.null_percentage,
                        numeric_stats=NumericStatsResponse(
                            min=cs.numeric_stats.min,
                            max=cs.numeric_stats.max,
                            median=cs.numeric_stats.median,
                            mean=cs.numeric_stats.mean,
                            stddev=cs.numeric_stats.stddev,
                            distinct_count=cs.numeric_stats.distinct_count,
                        ) if cs.numeric_stats else None,
                        categorical_stats=CategoricalStatsResponse(
                            unique_count=cs.categorical_stats.unique_count,
                            top_values=[
                                ValueFrequencyResponse(
                                    value=vf.value,
                                    frequency=vf.frequency,
                                )
                                for vf in cs.categorical_stats.top_values
                            ],
                            avg_length=cs.categorical_stats.avg_length,
                        ) if cs.categorical_stats else None,
                        date_stats=DateStatsResponse(
                            min_date=cs.date_stats.min_date,
                            max_date=cs.date_stats.max_date,
                            span_days=cs.date_stats.span_days,
                            distinct_days=cs.date_stats.distinct_days,
                        ) if cs.date_stats else None,
                    )
                    for cs in diagnosis.column_statistics
                ],
                sample_rows=diagnosis.sample_rows,
                llm_analysis=LLMAnalysisResponse(
                    suggested_name=diagnosis.llm_analysis.suggested_name,
                    context=diagnosis.llm_analysis.context,
                    potential=[
                        PotentialItemResponse(
                            question=p.question,
                            analysis=p.analysis,
                        )
                        for p in diagnosis.llm_analysis.potential
                    ],
                    issues=[
                        IssueItemResponse(
                            issue=i.issue,
                            issue_type=i.issue_type,
                            suggestion=i.suggestion,
                            example=i.example,
                        )
                        for i in diagnosis.llm_analysis.issues
                    ],
                    analyzed_at=diagnosis.llm_analysis.analyzed_at,
                    model_used=diagnosis.llm_analysis.model_used,
                ) if diagnosis.llm_analysis else None,
                diagnosis_id=diagnosis.diagnosis_id,
            )
        )

    if request.include_llm and request.llm_mode == "cache_only":
        llm_pending = (
            any(diagnosis.llm_analysis is None for diagnosis in all_diagnoses)
            or (
                request.include_merge_analysis
                and merge_context_dict is not None
                and merged_analysis_response is None
            )
        )
    elif request.include_llm and request.llm_mode == "defer":
        llm_pending = (
            llm_pending
            or any(diagnosis.llm_analysis is None for diagnosis in all_diagnoses)
            or (
                request.include_merge_analysis
                and merge_context_dict is not None
                and merged_analysis_response is None
            )
        )

    return DiagnoseFilesResponse(
        diagnoses=diagnoses,
        merged_analysis=merged_analysis_response,
        llm_pending=llm_pending,
    )


@router.get("/{file_id}/diagnosis", response_model=FileDiagnosisResponse)
def get_file_diagnosis(
    file_id: str,
    use_cache: bool = True,
    file_service: FileAssetService = Depends(get_file_asset_service_dep),
    diagnosis_service: FileDiagnosisService = Depends(get_file_diagnosis_service_dep),
) -> FileDiagnosisResponse:
    """Get diagnosis for a file asset.

    Retrieves the diagnosis linked to a file asset.
    First tries to lookup by diagnosis_id (if present), then falls back to file_path.
    Set use_cache=false to force a fresh diagnosis and update the cache.
    """
    logger.info(f"[get_file_diagnosis] Request for file_id={file_id}")
    asset = file_service.get_file(file_id)
    if not asset:
        logger.warning(f"[get_file_diagnosis] File asset not found: {file_id}")
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")

    logger.info(
        "[get_file_diagnosis] Asset found: id=%s, diagnosis_id=%s, file_path=%s",
        asset.id,
        asset.diagnosis_id,
        asset.file_path,
    )

    diagnosis = None

    if not use_cache:
        logger.info("[get_file_diagnosis] use_cache=false, running fresh diagnosis")
        try:
            diagnosis = diagnosis_service.diagnose_file(
                asset.file_path,
                asset.file_type,
            )
            saved_id = diagnosis_service.save_diagnosis(diagnosis)
            diagnosis.diagnosis_id = saved_id
            file_service.update_diagnosis_id(asset.id, saved_id)
            asset.diagnosis_id = saved_id
        except DiagnosisError as e:
            logger.error(f"[get_file_diagnosis] Fresh diagnosis failed: {e}")
            raise HTTPException(status_code=500, detail=f"Diagnosis failed: {e}")

    # Method 1: Lookup by diagnosis_id (if present)
    if diagnosis is None and asset.diagnosis_id:
        logger.info(
            "[get_file_diagnosis] Trying lookup by diagnosis_id: %s",
            asset.diagnosis_id,
        )
        diagnosis = diagnosis_service.get_diagnosis_by_id(asset.diagnosis_id)
        logger.info(
            "[get_file_diagnosis] Lookup result by diagnosis_id: %s",
            "FOUND" if diagnosis else "NOT FOUND",
        )

    # Method 2: Fallback to file_path lookup (for legacy assets without diagnosis_id)
    if diagnosis is None:
        logger.info(
            "[get_file_diagnosis] Trying fallback lookup by file_path: %s",
            asset.file_path,
        )
        diagnosis = diagnosis_service.get_cached_diagnosis(asset.file_path)
        logger.info(
            "[get_file_diagnosis] Lookup result by file_path: %s",
            "FOUND" if diagnosis else "NOT FOUND",
        )

    if diagnosis is None:
        logger.warning(f"[get_file_diagnosis] No diagnosis found for file_id={file_id}")
        raise HTTPException(status_code=404, detail=f"No diagnosis found for file '{file_id}'")

    # Convert to response
    return FileDiagnosisResponse(
        file_path=diagnosis.file_path,
        file_type=diagnosis.file_type,
        columns=[
            ColumnSchemaResponse(
                name=col.name,
                type=col.type,
                nullable=col.nullable,
            )
            for col in diagnosis.schema
        ],
        missing_values=diagnosis.missing_values,
        row_count=diagnosis.row_count,
        file_size_bytes=diagnosis.file_size_bytes,
        type_suggestions=[
            TypeSuggestionResponse(
                column_name=ts.column_name,
                current_type=ts.current_type,
                suggested_type=ts.suggested_type,
                confidence=ts.confidence,
                sample_values=ts.sample_values,
            )
            for ts in diagnosis.type_suggestions
        ],
        diagnosed_at=diagnosis.diagnosed_at,
        encoding=EncodingInfoResponse(
            detected=diagnosis.encoding.detected,
            confidence=diagnosis.encoding.confidence,
        ) if diagnosis.encoding else None,
        parsing_integrity=ParsingIntegrityResponse(
            total_lines=diagnosis.parsing_integrity.total_lines,
            parsed_rows=diagnosis.parsing_integrity.parsed_rows,
            malformed_rows=diagnosis.parsing_integrity.malformed_rows,
            has_errors=diagnosis.parsing_integrity.has_errors,
            error_message=diagnosis.parsing_integrity.error_message,
        ) if diagnosis.parsing_integrity else None,
        column_statistics=[
            ColumnStatisticsResponse(
                column_name=cs.column_name,
                column_type=cs.column_type,
                semantic_type=cs.semantic_type,
                null_count=cs.null_count,
                null_percentage=cs.null_percentage,
                numeric_stats=NumericStatsResponse(
                    min=cs.numeric_stats.min,
                    max=cs.numeric_stats.max,
                    median=cs.numeric_stats.median,
                    mean=cs.numeric_stats.mean,
                    stddev=cs.numeric_stats.stddev,
                    distinct_count=cs.numeric_stats.distinct_count,
                ) if cs.numeric_stats else None,
                categorical_stats=CategoricalStatsResponse(
                    unique_count=cs.categorical_stats.unique_count,
                    top_values=[
                        ValueFrequencyResponse(
                            value=vf.value,
                            frequency=vf.frequency,
                        )
                        for vf in cs.categorical_stats.top_values
                    ],
                    avg_length=cs.categorical_stats.avg_length,
                ) if cs.categorical_stats else None,
                date_stats=DateStatsResponse(
                    min_date=cs.date_stats.min_date,
                    max_date=cs.date_stats.max_date,
                    span_days=cs.date_stats.span_days,
                    distinct_days=cs.date_stats.distinct_days,
                ) if cs.date_stats else None,
            )
            for cs in diagnosis.column_statistics
        ],
        sample_rows=diagnosis.sample_rows,
        llm_analysis=LLMAnalysisResponse(
            suggested_name=diagnosis.llm_analysis.suggested_name,
            context=diagnosis.llm_analysis.context,
            potential=[
                PotentialItemResponse(
                    question=p.question,
                    analysis=p.analysis,
                )
                for p in diagnosis.llm_analysis.potential
            ],
                    issues=[
                        IssueItemResponse(
                            issue=i.issue,
                            issue_type=i.issue_type,
                            suggestion=i.suggestion,
                            example=i.example,
                        )
                        for i in diagnosis.llm_analysis.issues
                    ],
            analyzed_at=diagnosis.llm_analysis.analyzed_at,
            model_used=diagnosis.llm_analysis.model_used,
        ) if diagnosis.llm_analysis else None,
        diagnosis_id=diagnosis.diagnosis_id,
    )


@router.post("/{file_id}/summary/regenerate", response_model=FileDiagnosisResponse)
async def regenerate_summary(
    file_id: str,
    file_service: FileAssetService = Depends(get_file_asset_service_dep),
    diagnosis_service: FileDiagnosisService = Depends(get_file_diagnosis_service_dep),
) -> FileDiagnosisResponse:
    """Regenerate LLM summary (agent analysis) without touching issues."""
    from pluto_duck_backend.app.services.asset.llm_analysis_service import analyze_datasets_with_llm

    asset = file_service.get_file(file_id)
    if not asset:
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")

    diagnosis = None
    if asset.diagnosis_id:
        diagnosis = diagnosis_service.get_diagnosis_by_id(asset.diagnosis_id)
    if diagnosis is None:
        diagnosis = diagnosis_service.get_cached_diagnosis(asset.file_path)
    if diagnosis is None:
        diagnosis = diagnosis_service.diagnose_file(asset.file_path, asset.file_type)
        saved_id = diagnosis_service.save_diagnosis(diagnosis)
        diagnosis.diagnosis_id = saved_id
        file_service.update_diagnosis_id(asset.id, saved_id)

    batch_result = await analyze_datasets_with_llm([diagnosis])
    llm_result = batch_result.file_results.get(diagnosis.file_path)
    if not llm_result:
        raise HTTPException(status_code=500, detail="Failed to regenerate LLM summary")

    diagnosis.llm_analysis = llm_result
    if diagnosis.diagnosis_id:
        diagnosis_service.update_llm_analysis(diagnosis.diagnosis_id, llm_result)
    else:
        saved_id = diagnosis_service.save_diagnosis(diagnosis)
        diagnosis.diagnosis_id = saved_id
        file_service.update_diagnosis_id(asset.id, saved_id)

    return _diagnosis_to_response(diagnosis)


@router.post("/{file_id}/diagnosis/rescan", response_model=FileDiagnosisResponse)
def rescan_quick_scan(
    file_id: str,
    file_service: FileAssetService = Depends(get_file_asset_service_dep),
    diagnosis_service: FileDiagnosisService = Depends(get_file_diagnosis_service_dep),
) -> FileDiagnosisResponse:
    """Re-run technical diagnosis (quick scan) without touching issues."""
    asset = file_service.get_file(file_id)
    if not asset:
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")

    existing = None
    if asset.diagnosis_id:
        existing = diagnosis_service.get_diagnosis_by_id(asset.diagnosis_id)
    if existing is None:
        existing = diagnosis_service.get_cached_diagnosis(asset.file_path)

    diagnosis = diagnosis_service.diagnose_file(asset.file_path, asset.file_type)
    if existing and existing.llm_analysis:
        diagnosis.llm_analysis = existing.llm_analysis

    if asset.diagnosis_id and diagnosis_service.update_quick_scan(asset.diagnosis_id, diagnosis):
        diagnosis.diagnosis_id = asset.diagnosis_id
    else:
        saved_id = diagnosis_service.save_diagnosis(diagnosis)
        diagnosis.diagnosis_id = saved_id
        file_service.update_diagnosis_id(asset.id, saved_id)

    return _diagnosis_to_response(diagnosis)


@router.get("/{file_id}/issues", response_model=DiagnosisIssueListResponse)
def list_issues(
    file_id: str,
    status: Optional[str] = Query(None),
    include_deleted: bool = Query(False),
    file_service: FileAssetService = Depends(get_file_asset_service_dep),
    issue_service: DiagnosisIssueService = Depends(get_diagnosis_issue_service_dep),
) -> DiagnosisIssueListResponse:
    asset = file_service.get_file(file_id)
    if not asset:
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")

    issues = issue_service.list_issues(
        file_asset_id=asset.id,
        include_deleted=include_deleted,
        status=status,
    )
    return DiagnosisIssueListResponse(issues=[_issue_to_response(i) for i in issues])


@router.post("/{file_id}/issues/find", response_model=DiagnosisIssueListResponse)
async def find_issues(
    file_id: str,
    file_service: FileAssetService = Depends(get_file_asset_service_dep),
    diagnosis_service: FileDiagnosisService = Depends(get_file_diagnosis_service_dep),
    issue_service: DiagnosisIssueService = Depends(get_diagnosis_issue_service_dep),
) -> DiagnosisIssueListResponse:
    """Run LLM diagnosis to find issues and append them to history."""
    from pluto_duck_backend.app.services.asset.llm_analysis_service import analyze_datasets_with_llm

    asset = file_service.get_file(file_id)
    if not asset:
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")

    diagnosis = None
    if asset.diagnosis_id:
        diagnosis = diagnosis_service.get_diagnosis_by_id(asset.diagnosis_id)
    if diagnosis is None:
        diagnosis = diagnosis_service.get_cached_diagnosis(asset.file_path)
    if diagnosis is None:
        diagnosis = diagnosis_service.diagnose_file(asset.file_path, asset.file_type)
        saved_id = diagnosis_service.save_diagnosis(diagnosis)
        diagnosis.diagnosis_id = saved_id
        file_service.update_diagnosis_id(asset.id, saved_id)

    batch_result = await analyze_datasets_with_llm([diagnosis])
    llm_result = batch_result.file_results.get(diagnosis.file_path)
    if not llm_result:
        raise HTTPException(status_code=500, detail="Failed to generate issues")

    if diagnosis.diagnosis_id is None and asset.diagnosis_id is not None:
        diagnosis.diagnosis_id = asset.diagnosis_id

    if diagnosis.diagnosis_id is None:
        saved_id = diagnosis_service.save_diagnosis(diagnosis)
        diagnosis.diagnosis_id = saved_id
        file_service.update_diagnosis_id(asset.id, saved_id)

    issue_payloads = [issue.to_dict() for issue in llm_result.issues]
    if issue_payloads:
        issue_service.create_issues(
            diagnosis_id=diagnosis.diagnosis_id,
            file_asset_id=asset.id,
            issues=issue_payloads,
        )

    issues = issue_service.list_issues(file_asset_id=asset.id)
    return DiagnosisIssueListResponse(issues=[_issue_to_response(i) for i in issues])


@router.patch("/issues/{issue_id}", response_model=DiagnosisIssueResponse)
def update_issue(
    issue_id: str,
    request: DiagnosisIssueUpdateRequest,
    issue_service: DiagnosisIssueService = Depends(get_diagnosis_issue_service_dep),
) -> DiagnosisIssueResponse:
    updated = issue_service.update_issue(
        issue_id=issue_id,
        status=request.status,
        user_response=request.user_response,
        resolved_by=request.resolved_by,
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Issue '{issue_id}' not found")
    return _issue_to_response(updated)


@router.delete("/issues/{issue_id}", response_model=DiagnosisIssueResponse)
def delete_issue(
    issue_id: str,
    request: DiagnosisIssueDeleteRequest,
    issue_service: DiagnosisIssueService = Depends(get_diagnosis_issue_service_dep),
) -> DiagnosisIssueResponse:
    deleted = issue_service.soft_delete_issue(
        issue_id=issue_id,
        deleted_by=request.deleted_by,
        delete_reason=request.delete_reason,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Issue '{issue_id}' not found")
    return _issue_to_response(deleted)
