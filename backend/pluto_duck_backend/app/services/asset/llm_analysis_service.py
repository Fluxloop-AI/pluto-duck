"""LLM-based dataset analysis service.

This module provides functions to analyze file diagnoses using LLM,
extracting context, potential analyses, and data quality issues.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Dict, List, Optional

from pluto_duck_backend.app.services.llm import (
    BatchAnalysisSchema,
    FileAnalysisSchema,
    LLMService,
)

from .file_diagnosis_service import (
    FileDiagnosis,
    IssueItem,
    LLMAnalysisResult,
    PotentialItem,
)
from .prompts import load_dataset_analysis_prompt

logger = logging.getLogger(__name__)

# Batch size for LLM calls - can be adjusted for token efficiency
LLM_BATCH_SIZE = 5


@dataclass
class MergeContext:
    """Context information for merging multiple files with identical schemas."""

    schemas_identical: bool
    total_files: int
    total_rows: int
    duplicate_rows: int
    estimated_rows_after_dedup: int
    skipped: bool  # True if duplicate calculation was skipped due to row limit


@dataclass
class MergedAnalysisResult:
    """LLM analysis result for merged dataset."""

    suggested_name: str
    context: str


@dataclass
class BatchLLMAnalysisResult:
    """Combined result containing per-file analyses and optional merged analysis."""

    file_results: Dict[str, LLMAnalysisResult]
    merged_result: Optional[MergedAnalysisResult] = None


def format_diagnoses_for_llm(
    diagnoses: List[FileDiagnosis],
    merge_context: Optional[MergeContext] = None,
) -> str:
    """Format file diagnoses as JSON for LLM input.

    Args:
        diagnoses: List of FileDiagnosis objects
        merge_context: Optional context for merging files with identical schemas

    Returns:
        JSON string representing the diagnoses in LLM-friendly format.
        When merge_context is provided, returns a JSON object with 'files' and 'merge_context' keys.
        Otherwise, returns a JSON array of file information.
    """
    formatted = []
    for diag in diagnoses:
        file_info = {
            "file_path": diag.file_path,
            "file_name": os.path.basename(diag.file_path),
            "schema": [
                {"name": col.name, "type": col.type}
                for col in diag.schema
            ],
            "row_count": diag.row_count,
            "sample_rows": diag.sample_rows[:5],  # Limit to 5 rows
            "column_statistics": [
                {
                    "column_name": cs.column_name,
                    "semantic_type": cs.semantic_type,
                    "null_percentage": cs.null_percentage,
                }
                for cs in diag.column_statistics
            ],
        }
        formatted.append(file_info)

    # When merge_context is provided, wrap in object with merge context
    if merge_context is not None:
        result = {
            "files": formatted,
            "merge_context": {
                "schemas_identical": merge_context.schemas_identical,
                "total_files": merge_context.total_files,
                "total_rows": merge_context.total_rows,
                "duplicate_rows": merge_context.duplicate_rows,
                "estimated_rows_after_dedup": merge_context.estimated_rows_after_dedup,
                "skipped": merge_context.skipped,
            },
        }
        return json.dumps(result, ensure_ascii=False, indent=2)

    return json.dumps(formatted, ensure_ascii=False, indent=2)


def _schema_to_result(
    file_schema: FileAnalysisSchema,
    analyzed_at: datetime,
    model_used: str,
) -> LLMAnalysisResult:
    """Convert Pydantic FileAnalysisSchema to dataclass LLMAnalysisResult.

    Args:
        file_schema: Pydantic schema from structured LLM output
        analyzed_at: Timestamp of analysis
        model_used: Model identifier

    Returns:
        LLMAnalysisResult dataclass
    """
    potential = [
        PotentialItem(question=p.question, analysis=p.analysis)
        for p in file_schema.potential
    ]
    issues = [
        IssueItem(
            issue=i.issue,
            issue_type=i.issue_type or "general",
            suggestion=i.suggestion,
            example=i.example,
        )
        for i in file_schema.issues
    ]

    return LLMAnalysisResult(
        suggested_name=file_schema.suggested_name,
        context=file_schema.context,
        potential=potential,
        issues=issues,
        analyzed_at=analyzed_at,
        model_used=model_used,
    )


async def analyze_batch_with_llm(
    diagnoses: List[FileDiagnosis],
    llm_service: LLMService,
    merge_context: Optional[MergeContext] = None,
) -> BatchLLMAnalysisResult:
    """Analyze a batch of file diagnoses using LLM with structured output.

    Args:
        diagnoses: List of FileDiagnosis objects to analyze
        llm_service: LLMService instance
        merge_context: Optional context for merging files with identical schemas

    Returns:
        BatchLLMAnalysisResult containing per-file results and optional merged analysis
    """
    if not diagnoses:
        return BatchLLMAnalysisResult(file_results={})

    # Format diagnoses for LLM (with or without merge_context)
    input_json = format_diagnoses_for_llm(diagnoses, merge_context)

    # Load and format prompt
    prompt_template = load_dataset_analysis_prompt()
    prompt = prompt_template.replace("{input_json}", input_json)
    logger.debug(f"[LLM] Prompt:\n{prompt[:500]}...")  # 프롬프트 일부

    # Call LLM with structured output
    try:
        logger.info(f"[LLM] Calling LLM for {len(diagnoses)} files (merge_context={merge_context is not None})...")

        batch_result = await llm_service.complete_structured(
            prompt=prompt,
            response_schema=BatchAnalysisSchema,
        )
        logger.debug(f"[LLM] Raw response: {batch_result.model_dump_json()}")  # 전체 응답

        logger.info(f"[LLM] Got structured response with {len(batch_result.files)} files")

        # Convert to results dict
        file_results: Dict[str, LLMAnalysisResult] = {}
        analyzed_at = datetime.now(UTC)
        model_used = llm_service.model_name

        for file_schema in batch_result.files:
            file_path = file_schema.file_path
            file_results[file_path] = _schema_to_result(file_schema, analyzed_at, model_used)

            logger.info(f"[LLM] Parsed result for {file_path}:")
            logger.info(f"  - suggested_name: {file_schema.suggested_name}")
            context_preview = (
                f"{file_schema.context[:100]}..."
                if len(file_schema.context) > 100
                else file_schema.context
            )
            logger.info(f"  - context: {context_preview}")
            logger.info(f"  - potential: {len(file_schema.potential)} items")
            logger.info(f"  - issues: {len(file_schema.issues)} items")

        # Extract merged analysis result if available
        merged_result: Optional[MergedAnalysisResult] = None
        if batch_result.merged_suggested_name and batch_result.merged_context:
            merged_result = MergedAnalysisResult(
                suggested_name=batch_result.merged_suggested_name,
                context=batch_result.merged_context,
            )
            logger.info(f"[LLM] Merged analysis result:")
            logger.info(f"  - merged_suggested_name: {merged_result.suggested_name}")
            logger.info(f"  - merged_context: {merged_result.context[:100]}...")

        return BatchLLMAnalysisResult(file_results=file_results, merged_result=merged_result)
    except Exception as e:
        logger.error(f"[LLM] Analysis failed: {e}", exc_info=True)
        return BatchLLMAnalysisResult(file_results={})


async def analyze_datasets_with_llm(
    diagnoses: List[FileDiagnosis],
    llm_service: LLMService | None = None,
    merge_context: Optional[MergeContext] = None,
) -> BatchLLMAnalysisResult:
    """Analyze multiple file diagnoses using LLM with batching.

    Splits diagnoses into batches of LLM_BATCH_SIZE and processes
    them in parallel using asyncio.gather().

    When merge_context is provided, all files are analyzed in a single batch
    to allow the LLM to generate a unified merged analysis.

    Args:
        diagnoses: List of FileDiagnosis objects to analyze
        llm_service: Optional LLMService instance. If None, creates a new one.
        merge_context: Optional context for merging files with identical schemas

    Returns:
        BatchLLMAnalysisResult containing per-file results and optional merged analysis
    """
    if not diagnoses:
        return BatchLLMAnalysisResult(file_results={})

    # Get LLM service if not provided
    if llm_service is None:
        llm_service = LLMService()
        logger.info(
            f"[LLM DEBUG] Using LLMService with model={llm_service.model_name}, "
            f"provider={llm_service.provider_name}"
        )

    # When merge_context is provided, analyze all files in a single batch
    # to get a unified merged analysis
    if merge_context is not None:
        logger.info(
            f"Analyzing {len(diagnoses)} files in single batch with merge_context"
        )
        return await analyze_batch_with_llm(diagnoses, llm_service, merge_context)

    # Otherwise, split into batches for parallel processing
    batches: List[List[FileDiagnosis]] = []
    for i in range(0, len(diagnoses), LLM_BATCH_SIZE):
        batches.append(diagnoses[i : i + LLM_BATCH_SIZE])

    logger.info(
        f"Analyzing {len(diagnoses)} files in {len(batches)} batches "
        f"(batch size: {LLM_BATCH_SIZE})"
    )

    # Process batches in parallel
    tasks = [
        analyze_batch_with_llm(batch, llm_service)
        for batch in batches
    ]
    batch_results = await asyncio.gather(*tasks, return_exceptions=True)

    # Merge results
    all_file_results: Dict[str, LLMAnalysisResult] = {}
    for result in batch_results:
        if isinstance(result, Exception):
            logger.error(f"Batch analysis failed: {result}")
            continue
        if isinstance(result, BatchLLMAnalysisResult):
            all_file_results.update(result.file_results)

    logger.info(f"LLM analysis completed: {len(all_file_results)}/{len(diagnoses)} files analyzed")
    return BatchLLMAnalysisResult(file_results=all_file_results)
