from pluto_duck_backend.agent.core.deep.tools.schema import (
    _build_internal_table_access_error,
    _is_internal_table_identifier,
)


def test_is_internal_table_identifier_matches_qualified_and_unqualified() -> None:
    assert _is_internal_table_identifier("projects")
    assert _is_internal_table_identifier("projects", schema="main")
    assert _is_internal_table_identifier("main.projects")
    assert _is_internal_table_identifier('"main"."projects"')
    assert _is_internal_table_identifier("files", schema="_file_assets")
    assert _is_internal_table_identifier("_file_assets.files")


def test_is_internal_table_identifier_respects_schema_boundary() -> None:
    assert not _is_internal_table_identifier("projects", schema="analysis")
    assert not _is_internal_table_identifier("analysis.projects")


def test_internal_table_access_error_contract() -> None:
    message = _build_internal_table_access_error("projects", schema="main")
    assert message == (
        "Access to internal metadata table 'main.projects' is blocked in schema tools. "
        "Use run_sql for explicit inspection."
    )
