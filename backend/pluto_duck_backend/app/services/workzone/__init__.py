"""Work Zone service - Session-scoped temporary workspace management.

Each conversation gets its own isolated DuckDB workspace for:
- Temporary query results
- Ad-hoc analysis tables
- Session-specific cached data

Work zones have TTL and are cleaned up when expired or explicitly closed.
"""

from .service import WorkZoneService, WorkZone, get_work_zone_service

__all__ = [
    "WorkZoneService",
    "WorkZone",
    "get_work_zone_service",
]

