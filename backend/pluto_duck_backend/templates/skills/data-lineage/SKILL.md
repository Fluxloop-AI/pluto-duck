---
name: data-lineage
description: Track data dependencies and freshness for analyses. Use when the user asks about upstream/downstream tables, data lineage, dependency tracking, staleness, freshness checks, or wants to understand which analyses feed into others.
---

# Data Lineage (Pluto Duck)

Use this skill to trace data dependencies and verify data freshness across your warehouse analyses.

## When to Use

- "What tables does this analysis depend on?"
- "Which analyses use this table?"
- "Is this data fresh/stale?"
- "Show me the data lineage"
- "What's upstream/downstream of X?"

## Workflow

### Step 1: Identify the target

1. If user mentions a specific analysis:
   - `list_analyses` to confirm it exists
   - `get_analysis(name)` to get details
2. If user mentions a table:
   - `describe_table(table_name)` to confirm it exists

### Step 2: Trace lineage

1. Run: `get_lineage(name)`
   - Returns upstream (dependencies) and downstream (dependents)
2. For each important node:
   - Check if it's an analysis (`get_analysis`) or base table (`describe_table`)

### Step 3: Check freshness (if relevant)

1. Run: `get_freshness(name)`
   - Returns last refresh timestamp and staleness status
2. If stale:
   - Identify which upstream is causing staleness
   - Suggest re-running the analysis pipeline

### Step 4: Report findings

Return:
- Visual or text representation of the lineage graph
- Freshness status of key nodes
- Any broken dependencies or stale data warnings

## Example Responses

**Simple lineage request:**
```
Analysis `monthly_sales` depends on:
  └── orders (base table)
  └── customers (base table)

Downstream analyses that use monthly_sales:
  └── quarterly_report
  └── sales_dashboard
```

**Freshness check:**
```
monthly_sales: ✅ Fresh (last run: 2 hours ago)
  └── orders: ✅ Fresh
  └── customers: ⚠️ Stale (3 days old)
      └── Recommendation: Refresh customers table before re-running monthly_sales
```

## Notes

- Lineage only tracks saved analyses created via `save_analysis`
- Base tables (from external sources) don't have upstream lineage
- Use `list_analyses` first if you're unsure what analyses exist

