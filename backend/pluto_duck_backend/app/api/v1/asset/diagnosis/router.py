"""Asset Diagnosis API Router - File diagnosis endpoints."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from pluto_duck_backend.app.api.deps import get_project_id_query
from pluto_duck_backend.app.api.v1.asset.diagnosis.schemas import (
    CategoricalStatsResponse,
    ColumnSchemaResponse,
    ColumnStatisticsResponse,
    CountDuplicatesRequest,
    CountDuplicatesResponse,
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
    FileAssetService,
    FileDiagnosisService,
    get_file_asset_service,
    get_file_diagnosis_service,
)
from pluto_duck_backend.app.services.asset.errors import DiagnosisError

logger = logging.getLogger(__name__)


router = APIRouter()


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
    try:
        if request.include_llm:
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
                            suggestion=i.suggestion,
                        )
                        for i in diagnosis.llm_analysis.issues
                    ],
                    analyzed_at=diagnosis.llm_analysis.analyzed_at,
                    model_used=diagnosis.llm_analysis.model_used,
                ) if diagnosis.llm_analysis else None,
                diagnosis_id=diagnosis.diagnosis_id,
            )
        )

    return DiagnoseFilesResponse(diagnoses=diagnoses, merged_analysis=merged_analysis_response)


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
                    suggestion=i.suggestion,
                )
                for i in diagnosis.llm_analysis.issues
            ],
            analyzed_at=diagnosis.llm_analysis.analyzed_at,
            model_used=diagnosis.llm_analysis.model_used,
        ) if diagnosis.llm_analysis else None,
        diagnosis_id=diagnosis.diagnosis_id,
    )
