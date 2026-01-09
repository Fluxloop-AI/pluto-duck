"""Source and cache tools for the deep agent.

These tools allow the agent to:
1. Attach external databases (Postgres, SQLite, etc.)
2. Query live data from attached sources
3. Cache tables locally for better performance
4. Get smart recommendations on caching
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from langchain_core.tools import StructuredTool

from pluto_duck_backend.app.services.source import (
    SourceService,
    SourceType,
    AttachError,
    CacheError,
    SourceNotFoundError,
    get_source_service,
)


def build_source_tools(*, project_id: str) -> List[StructuredTool]:
    """Build source and cache tools bound to a specific project.
    
    Args:
        project_id: Project identifier for isolation
    """

    def _get_service() -> SourceService:
        return get_source_service(project_id)

    # =========================================================================
    # Source Connection Tools
    # =========================================================================

    def attach_postgres(
        name: str,
        host: str,
        database: str,
        user: str,
        password: str,
        port: int = 5432,
        schema: str = "public",
    ) -> Dict[str, Any]:
        """Attach a PostgreSQL database as a named source.

        After attaching, you can query tables directly using {name}.{table_name}.

        Args:
            name: Alias for this connection (e.g., "sales", "pg")
            host: PostgreSQL host address
            database: Database name
            user: Username
            password: Password
            port: Port number (default 5432)
            schema: Schema to use (default "public")

        Returns:
            Connection status and available tables
        """
        service = _get_service()
        try:
            source = service.attach_source(
                name=name,
                source_type=SourceType.POSTGRES,
                config={
                    "host": host,
                    "port": port,
                    "database": database,
                    "user": user,
                    "password": password,
                    "schema": schema,
                },
            )

            # List available tables
            tables = service.list_source_tables(name)
            table_names = [f"{t.schema_name}.{t.table_name}" if t.schema_name else t.table_name for t in tables[:20]]

            return {
                "status": "success",
                "message": f"✅ PostgreSQL '{database}' 데이터베이스를 '{name}'으로 연결했어요.",
                "source_name": name,
                "tables_count": len(tables),
                "tables_preview": table_names,
                "usage_hint": f"SELECT * FROM {name}.table_name 형식으로 쿼리할 수 있어요.",
            }
        except AttachError as e:
            return {
                "status": "error",
                "message": f"❌ 연결 실패: {e}",
            }

    def attach_sqlite(
        name: str,
        path: str,
    ) -> Dict[str, Any]:
        """Attach a SQLite database file as a named source.

        Args:
            name: Alias for this connection (e.g., "local_db")
            path: Path to the SQLite database file

        Returns:
            Connection status and available tables
        """
        service = _get_service()
        try:
            source = service.attach_source(
                name=name,
                source_type=SourceType.SQLITE,
                config={"path": path},
            )

            tables = service.list_source_tables(name)
            table_names = [t.table_name for t in tables[:20]]

            return {
                "status": "success",
                "message": f"✅ SQLite '{path}'를 '{name}'으로 연결했어요.",
                "source_name": name,
                "tables_count": len(tables),
                "tables_preview": table_names,
                "usage_hint": f"SELECT * FROM {name}.table_name 형식으로 쿼리할 수 있어요.",
            }
        except AttachError as e:
            return {
                "status": "error",
                "message": f"❌ 연결 실패: {e}",
            }

    def list_sources() -> Dict[str, Any]:
        """List all attached data sources.

        Returns:
            List of attached sources with their status
        """
        service = _get_service()
        sources = service.list_sources()

        if not sources:
            return {
                "status": "success",
                "message": "연결된 데이터 소스가 없어요.",
                "sources": [],
            }

        source_list = [
            {
                "name": s.name,
                "type": s.source_type.value,
                "status": s.status,
                "attached_at": s.attached_at.isoformat() if s.attached_at else None,
            }
            for s in sources
        ]

        return {
            "status": "success",
            "sources": source_list,
        }

    def list_source_tables(source_name: str) -> Dict[str, Any]:
        """List all tables available from an attached source.

        Args:
            source_name: The source alias (e.g., "pg", "sales")

        Returns:
            List of tables with their access mode (live/cached)
        """
        service = _get_service()
        try:
            tables = service.list_source_tables(source_name)

            table_list = [
                {
                    "name": f"{t.schema_name}.{t.table_name}" if t.schema_name else t.table_name,
                    "mode": t.mode.value,
                    "local_table": t.local_table,
                }
                for t in tables
            ]

            live_count = sum(1 for t in tables if t.mode.value == "live")
            cached_count = sum(1 for t in tables if t.mode.value == "cached")

            return {
                "status": "success",
                "source_name": source_name,
                "total_tables": len(tables),
                "live_tables": live_count,
                "cached_tables": cached_count,
                "tables": table_list,
            }
        except SourceNotFoundError:
            return {
                "status": "error",
                "message": f"'{source_name}' 소스를 찾을 수 없어요. list_sources로 연결된 소스를 확인해보세요.",
            }

    def detach_source(source_name: str) -> Dict[str, Any]:
        """Detach (disconnect) an attached data source.

        Args:
            source_name: The source alias to detach

        Returns:
            Status message
        """
        service = _get_service()
        if service.detach_source(source_name):
            return {
                "status": "success",
                "message": f"✅ '{source_name}' 연결을 해제했어요.",
            }
        return {
            "status": "error",
            "message": f"'{source_name}' 소스를 찾을 수 없어요.",
        }

    # =========================================================================
    # Cache Tools
    # =========================================================================

    def cache_table(
        source_name: str,
        table_name: str,
        filter_sql: Optional[str] = None,
        local_name: Optional[str] = None,
        expires_hours: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Cache a table from an attached source to local DuckDB.

        Caching copies the data locally, making queries much faster.
        Use for tables you query frequently or for complex analysis.

        Args:
            source_name: The source alias (e.g., "pg", "sales")
            table_name: Table to cache (e.g., "orders", "public.customers")
            filter_sql: Optional WHERE clause to filter data
                       (e.g., "order_date >= '2024-01-01'")
            local_name: Optional custom name for local table
                       (default: {source}_{table})
            expires_hours: Optional TTL in hours (auto-cleanup)

        Returns:
            Cache details including row count and local table name

        Examples:
            # Cache entire table
            cache_table("pg", "orders")

            # Cache recent data only
            cache_table("pg", "orders", filter_sql="order_date >= '2024-01-01'")

            # Cache with custom name
            cache_table("pg", "orders", local_name="recent_orders",
                       filter_sql="order_date >= '2024-06-01'")
        """
        service = _get_service()
        try:
            cached = service.cache_table(
                source_name=source_name,
                source_table=table_name,
                local_table=local_name,
                filter_sql=filter_sql,
                expires_hours=expires_hours,
            )

            return {
                "status": "success",
                "message": f"✅ {cached.row_count:,}건을 로컬에 캐시했어요.",
                "local_table": f"cache.{cached.local_table}",
                "row_count": cached.row_count,
                "cached_at": cached.cached_at.isoformat(),
                "expires_at": cached.expires_at.isoformat() if cached.expires_at else None,
                "filter": filter_sql,
                "usage_hint": f"SELECT * FROM cache.{cached.local_table} 로 쿼리하세요.",
            }
        except SourceNotFoundError:
            return {
                "status": "error",
                "message": f"'{source_name}' 소스를 찾을 수 없어요.",
            }
        except CacheError as e:
            return {
                "status": "error",
                "message": f"❌ 캐시 실패: {e}",
            }

    def refresh_cache(local_table: str) -> Dict[str, Any]:
        """Refresh an existing cached table with fresh data.

        Args:
            local_table: The local cache table name (without 'cache.' prefix)

        Returns:
            Updated cache details
        """
        service = _get_service()
        try:
            cached = service.refresh_cache(local_table)
            return {
                "status": "success",
                "message": f"✅ 캐시를 갱신했어요. {cached.row_count:,}건",
                "local_table": f"cache.{cached.local_table}",
                "row_count": cached.row_count,
                "cached_at": cached.cached_at.isoformat(),
            }
        except CacheError as e:
            return {
                "status": "error",
                "message": f"❌ 갱신 실패: {e}",
            }

    def drop_cache(local_table: str) -> Dict[str, Any]:
        """Drop (delete) a cached table.

        Args:
            local_table: The local cache table name (without 'cache.' prefix)

        Returns:
            Status message
        """
        service = _get_service()
        if service.drop_cache(local_table):
            return {
                "status": "success",
                "message": f"✅ cache.{local_table} 캐시를 삭제했어요.",
            }
        return {
            "status": "error",
            "message": f"'{local_table}' 캐시를 찾을 수 없어요.",
        }

    def list_cached_tables(source_name: Optional[str] = None) -> Dict[str, Any]:
        """List all cached tables.

        Args:
            source_name: Optional filter by source

        Returns:
            List of cached tables with details
        """
        service = _get_service()
        cached = service.list_cached_tables(source_name)

        if not cached:
            return {
                "status": "success",
                "message": "캐시된 테이블이 없어요.",
                "cached_tables": [],
            }

        table_list = [
            {
                "local_table": f"cache.{c.local_table}",
                "source": f"{c.source_name}.{c.source_table}",
                "row_count": c.row_count,
                "cached_at": c.cached_at.isoformat() if c.cached_at else None,
                "expires_at": c.expires_at.isoformat() if c.expires_at else None,
                "filter": c.filter_sql,
            }
            for c in cached
        ]

        return {
            "status": "success",
            "cached_tables": table_list,
        }

    # =========================================================================
    # Smart Cache Suggestion
    # =========================================================================

    def suggest_cache(source_name: str, table_name: str) -> Dict[str, Any]:
        """Get smart caching recommendation for a table.

        Analyzes table size and provides recommendations on whether
        to cache and how.

        Args:
            source_name: The source alias
            table_name: Table to analyze

        Returns:
            Size estimate and caching recommendation
        """
        service = _get_service()
        try:
            estimate = service.estimate_table_size(source_name, table_name)
            return {
                "status": "success",
                **estimate,
            }
        except SourceNotFoundError:
            return {
                "status": "error",
                "message": f"'{source_name}' 소스를 찾을 수 없어요.",
            }

    # =========================================================================
    # Build Tool List
    # =========================================================================

    return [
        # Connection tools
        StructuredTool.from_function(
            name="attach_postgres",
            func=attach_postgres,
            description=(
                "PostgreSQL 데이터베이스를 연결합니다. "
                "연결 후 {name}.{table} 형식으로 직접 쿼리할 수 있어요."
            ),
        ),
        StructuredTool.from_function(
            name="attach_sqlite",
            func=attach_sqlite,
            description="SQLite 데이터베이스 파일을 연결합니다.",
        ),
        StructuredTool.from_function(
            name="list_sources",
            func=list_sources,
            description="연결된 모든 데이터 소스를 조회합니다.",
        ),
        StructuredTool.from_function(
            name="list_source_tables",
            func=list_source_tables,
            description="연결된 소스의 테이블 목록을 조회합니다. Live/Cached 상태도 표시됩니다.",
        ),
        StructuredTool.from_function(
            name="detach_source",
            func=detach_source,
            description="연결된 데이터 소스를 해제합니다.",
        ),
        # Cache tools
        StructuredTool.from_function(
            name="cache_table",
            func=cache_table,
            description=(
                "외부 테이블을 로컬에 캐시합니다. "
                "큰 테이블이나 자주 쿼리하는 테이블에 사용하면 빨라져요. "
                "filter_sql로 필요한 데이터만 가져올 수도 있어요."
            ),
        ),
        StructuredTool.from_function(
            name="refresh_cache",
            func=refresh_cache,
            description="캐시된 테이블을 최신 데이터로 갱신합니다.",
        ),
        StructuredTool.from_function(
            name="drop_cache",
            func=drop_cache,
            description="캐시된 테이블을 삭제합니다.",
        ),
        StructuredTool.from_function(
            name="list_cached_tables",
            func=list_cached_tables,
            description="캐시된 테이블 목록을 조회합니다.",
        ),
        # Smart suggestion
        StructuredTool.from_function(
            name="suggest_cache",
            func=suggest_cache,
            description=(
                "테이블 크기를 분석하고 캐싱 추천을 제공합니다. "
                "큰 테이블 쿼리 전에 먼저 확인하면 좋아요."
            ),
        ),
    ]

