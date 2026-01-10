---
name: source-explorer
description: Explore connected data sources and their tables. Use when the user wants to discover what databases are connected, browse tables in external sources (PostgreSQL, SQLite, etc.), check cached tables, or find available file assets (CSV, Parquet).
---

# Source Explorer (Pluto Duck)

Use this skill to discover and explore connected data sources, their tables, and cached data.

## When to Use

- "What data sources are connected?"
- "What tables are in my Postgres?"
- "Show me available data"
- "What files can I query?"
- "Is this table cached?"
- "What's in the warehouse?"

## Workflow

### Step 1: Survey available sources

1. Start with: `list_sources`
   - Shows all attached sources (PostgreSQL, SQLite, etc.)
   - Note the source names for further exploration

2. Check file assets: `list_files`
   - Shows CSV, Parquet files available for querying
   - These are directly queryable without caching

3. Check DuckDB tables: `list_tables`
   - Shows all tables in the local warehouse
   - Includes cached tables and saved analyses

### Step 2: Explore a specific source

If user asks about a specific source:

1. Run: `list_source_tables(source_name)`
   - Lists all tables/views in that source
   - Shows basic metadata (row counts if available)

2. For interesting tables:
   - `describe_table("source_name.table_name")` for schema
   - `sample_rows("source_name.table_name", limit=5)` for preview

### Step 3: Check caching status

1. Run: `list_cached_tables`
   - Shows which source tables have been cached locally
   - Includes last refresh timestamp

2. For cached data:
   - Query cached tables directly: `run_sql("SELECT * FROM cached_table LIMIT 5")`
   - Check freshness with: `get_freshness(cached_table)`

### Step 4: Summarize findings

Return:
- List of connected sources with brief descriptions
- Notable tables in each source
- Caching status and recommendations
- File assets available for analysis

## Example Response

```
📊 Connected Data Sources:

1. **prod_postgres** (PostgreSQL)
   - 12 tables: orders, customers, products, ...
   - Cached: orders, customers (last sync: 1 hour ago)

2. **legacy_sqlite** (SQLite)
   - 5 tables: old_orders, legacy_users, ...
   - Not cached

📁 File Assets:
   - sales_2024.csv (15MB)
   - inventory.parquet (2MB)

💾 Local Warehouse:
   - 8 analyses: monthly_sales, customer_segments, ...
   - 2 cached tables: orders, customers
```

## Common Patterns

### Quick data inventory
```
1. list_sources → see connections
2. list_files → see file assets
3. list_tables → see warehouse tables
4. list_cached_tables → see what's locally cached
```

### Deep dive into a source
```
1. list_source_tables(source) → get table list
2. describe_table(source.table) → see schema
3. sample_rows(source.table) → preview data
4. Optionally: cache frequently used tables via UI
```

## Notes

- Source connections are managed via UI, not agent tools
- Caching is done via UI; agent can only read cache status
- File assets (CSV/Parquet) are directly queryable without caching
- Use qualified names (`source_name.table_name`) for source tables

