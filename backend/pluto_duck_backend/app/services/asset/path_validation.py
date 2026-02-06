from __future__ import annotations

from pathlib import Path


def normalize_and_validate_user_file_path(file_path: str) -> str:
    raw = (file_path or "").strip()
    if not raw:
        raise ValueError("Invalid file path: path is required")
    if "\x00" in raw:
        raise ValueError("Invalid file path: null bytes are not allowed")

    expanded = Path(raw).expanduser()
    if not expanded.is_absolute():
        raise ValueError("Invalid file path: absolute path is required")
    if any(part == ".." for part in expanded.parts):
        raise ValueError("Invalid file path: parent traversal ('..') is not allowed")

    try:
        normalized = expanded.resolve(strict=False)
    except OSError as exc:
        raise ValueError(f"Invalid file path: {exc}") from exc

    return str(normalized)
