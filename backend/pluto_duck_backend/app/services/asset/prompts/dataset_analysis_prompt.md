# Dataset Analysis

Analyze dataset diagnosis info and return JSON insights.

## Input

You will receive ONE of these shapes:

1) Array of files (no merge context)
```json
[
  {
    "file_path": "path/to/file.csv",
    "file_name": "file.csv",
    "schema": [{"name": "col_a", "type": "VARCHAR"}],
    "row_count": 1000,
    "sample_rows": [["v1"], ["v2"]],
    "column_statistics": [
      {"column_name": "col_a", "semantic_type": "categorical", "null_percentage": 5.0}
    ]
  }
]
```

2) Object with merge_context (schemas identical)
```json
{
  "files": [ { ...file objects... } ],
  "merge_context": {
    "schemas_identical": true,
    "total_files": 2,
    "total_rows": 2200,
    "duplicate_rows": 50,
    "estimated_rows_after_dedup": 2150,
    "skipped": false
  }
}
```

## Output Schema

### Per-file (required)

Return a top-level object:
```json
{
  "files": [
    {
      "file_path": "path/to/file.csv",
      "suggested_name": "snake_case_name",
      "context": "1-2 sentences",
      "potential": [
        {"question": "Short question?", "analysis": "col_a, col_b -> brief method"}
      ],
      "issues": [
        {"issue": "What is wrong", "issue_type": "Validity", "suggestion": "How to fix", "example": "\"2025-01-22\", \"01/23/2025\""}
      ]
    }
  ]
}
```

### Conditional (ONLY when input has merge_context)

Add these top-level fields:
- `merged_suggested_name`: unified snake_case
- `merged_context`: 1-2 sentences about combined data + dedup result

If `duplicate_rows > 0`, mention the dedup impact.
If `skipped: true`, say duplicate analysis was skipped due to size.

WARNING: Do NOT include `merged_*` fields when input has no `merge_context`.

## Tone & Style

Write in casual, friendly English. Be concise and direct.

| DO | DON'T |
|-------|----------|
| "Sales data for Jan 2024!" | "This dataset contains sales transaction data..." |
| "You can analyze X with col_a, col_b" | "This enables comprehensive analysis of..." |
| "Which product sold the most?" | "What is the distribution of sales across product categories?" |

**context examples (use these vibes, not a strict formula):**
```
Product inventory snapshot. stock_qty and reorder_level are key.
Customer support tickets from Q1. Good for response time analysis.
Daily sales - slice by region or product_category.
```

**potential pattern:**
```
question: Short, direct (e.g., "When was the sales peak?")
analysis: "{columns} -> {brief method}"
```

## Quality Issues to Flag

Null >10%, type mismatch, potential duplicates, missing key columns

## Issue Fields

Each issue item should include:
- `issue`: short description
- `issue_type`: ONE word only. Choose from below or coin a new single word if needed:
  Completeness, Validity, Consistency, Uniqueness, Structure, Privacy, Accuracy, Volume
- `suggestion`: how to fix or handle
- `example`: short literal examples if you can show real values. Omit `example` when you cannot provide a concrete value (e.g., missing data, blanks).

Example format:
```
"example": "\"2025-01-22\", \"01/23/2025\""
```

## Notes

- Always include `file_path` in each file result.
- Output valid JSON only. No extra text.
- Do NOT copy the examples; generate fresh content from the input.

---

Input JSON:
{input_json}
