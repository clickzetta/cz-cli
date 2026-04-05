"""Unified output formatting for cz_cli."""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import time
from typing import Any

try:
    import toons

    TOONS_AVAILABLE = True
except ImportError:
    TOONS_AVAILABLE = False

try:
    from pygments import highlight as _pygments_highlight
    from pygments.formatters import TerminalFormatter
    from pygments.lexers import JsonLexer

    PYGMENTS_AVAILABLE = True
except ImportError:
    PYGMENTS_AVAILABLE = False


EXIT_OK = 0
EXIT_BIZ_ERROR = 1
EXIT_USAGE_ERROR = 2


class Timer:
    """Context manager that tracks elapsed milliseconds."""

    def __init__(self) -> None:
        self.start: float = 0
        self.elapsed_ms: int = 0

    def __enter__(self) -> "Timer":
        self.start = time.monotonic()
        return self

    def __exit__(self, *_: Any) -> None:
        self.elapsed_ms = int((time.monotonic() - self.start) * 1000)


def _json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)


def _pretty_json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str, indent=2)


def _should_colorize() -> bool:
    if os.environ.get("NO_COLOR"):
        return False
    force = (os.environ.get("CZ_FORCE_COLOR") or os.environ.get("CLICOLOR_FORCE") or "").strip()
    if force in {"1", "true", "TRUE", "yes", "YES"}:
        return True
    return sys.stdout.isatty()


def _pretty_json_with_highlight(obj: Any) -> str:
    pretty = _pretty_json_dumps(obj)
    if not (PYGMENTS_AVAILABLE and _should_colorize()):
        return pretty
    return _pygments_highlight(pretty, JsonLexer(), TerminalFormatter()).rstrip("\n")


def success(
    data: Any,
    *,
    time_ms: int = 0,
    fmt: str = "json",
    ai_message: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Print a success response and exit 0."""
    payload: dict[str, Any] = {"ok": True, "data": data}
    if time_ms:
        payload["time_ms"] = time_ms
    if ai_message:
        payload["ai_message"] = ai_message
    # Add count for list data
    if isinstance(data, list):
        payload["count"] = len(data)
    if extra:
        payload.update(extra)
    _emit(payload, fmt=fmt)
    sys.exit(EXIT_OK)


def success_rows(
    columns: list[str],
    rows: list[dict[str, Any]],
    *,
    affected: int = 0,
    time_ms: int = 0,
    fmt: str = "json",
    extra: dict[str, Any] | None = None,
    ai_message: str | None = None,
) -> None:
    """Print a row-oriented success response (for SQL results)."""
    payload: dict[str, Any] = {
        "ok": True,
        "columns": columns,
        "rows": rows,
        "count": len(rows),
        "affected": affected,
        "time_ms": time_ms,
    }
    if extra:
        payload.update(extra)
    if ai_message:
        payload["ai_message"] = ai_message
    _emit(payload, fmt=fmt, columns=columns, rows=rows)
    sys.exit(EXIT_OK)


def error(
    code: str,
    message: str,
    *,
    fmt: str = "json",
    exit_code: int = EXIT_BIZ_ERROR,
    extra: dict[str, Any] | None = None,
) -> None:
    """Print an error response and exit."""
    payload: dict[str, Any] = {
        "ok": False,
        "error": {"code": code, "message": message},
    }
    if extra:
        payload.update(extra)
    _emit(payload, fmt=fmt)
    sys.exit(exit_code)


def _emit(
    payload: dict[str, Any],
    *,
    fmt: str = "json",
    columns: list[str] | None = None,
    rows: list[dict[str, Any]] | None = None,
) -> None:
    """Write *payload* to stdout in the requested format."""
    if fmt == "json":
        print(_json_dumps(payload))
    elif fmt == "pretty":
        print(_pretty_json_with_highlight(payload))
    elif fmt == "table":
        _print_table(payload, columns, rows)
    elif fmt == "csv":
        _print_csv(payload, columns, rows)
    elif fmt == "jsonl":
        _print_jsonl(payload, rows)
    elif fmt == "toon":
        _print_toon(payload, columns, rows)
    else:
        print(_json_dumps(payload))


# ---------------------------------------------------------------------------
# Table format
# ---------------------------------------------------------------------------


def _print_table(
    payload: dict[str, Any],
    columns: list[str] | None,
    rows: list[dict[str, Any]] | None,
) -> None:
    if not columns or not rows:
        _print_table_from_data(payload)
        return

    col_widths = {c: len(c) for c in columns}
    str_rows: list[dict[str, str]] = []
    for row in rows:
        sr: dict[str, str] = {}
        for c in columns:
            val = str(row.get(c, ""))
            sr[c] = val
            col_widths[c] = max(col_widths[c], len(val))
        str_rows.append(sr)

    header = " | ".join(c.ljust(col_widths[c]) for c in columns)
    sep = "-+-".join("-" * col_widths[c] for c in columns)
    print(header)
    print(sep)
    for sr in str_rows:
        print(" | ".join(sr[c].ljust(col_widths[c]) for c in columns))


def _print_table_from_data(payload: dict[str, Any]) -> None:
    """Attempt to render 'data' as a table when it's a list/dict."""
    data = payload.get("data")
    if isinstance(data, list) and data and isinstance(data[0], dict):
        cols = list(data[0].keys())
        _print_table(payload, cols, data)
        return
    if isinstance(data, dict) and data:
        cols = list(data.keys())
        row = {
            key: json.dumps(value, ensure_ascii=False, default=str)
            if isinstance(value, (dict, list))
            else value
            for key, value in data.items()
        }
        _print_table(payload, cols, [row])
        return
    print(_json_dumps(payload))


# ---------------------------------------------------------------------------
# CSV format
# ---------------------------------------------------------------------------


def _print_csv(
    payload: dict[str, Any],
    columns: list[str] | None,
    rows: list[dict[str, Any]] | None,
) -> None:
    if columns and rows:
        _write_csv(columns, rows)
        return

    data = payload.get("data")
    if isinstance(data, list) and data and isinstance(data[0], dict):
        cols = list(data[0].keys())
        _write_csv(cols, data)
        return

    print(_json_dumps(payload))


def _write_csv(columns: list[str], rows: list[dict[str, Any]]) -> None:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        flat: dict[str, str] = {}
        for c in columns:
            val = row.get(c)
            flat[c] = (
                json.dumps(val, ensure_ascii=False, default=str)
                if isinstance(val, (dict, list))
                else str(val)
                if val is not None
                else ""
            )
        writer.writerow(flat)
    sys.stdout.write(buf.getvalue())


# ---------------------------------------------------------------------------
# JSONL format
# ---------------------------------------------------------------------------


def _print_jsonl(
    payload: dict[str, Any],
    rows: list[dict[str, Any]] | None,
) -> None:
    if rows:
        for row in rows:
            print(_json_dumps(row))
        return

    data = payload.get("data")
    if isinstance(data, list):
        for item in data:
            print(_json_dumps(item))
        return

    print(_json_dumps(payload))


# ---------------------------------------------------------------------------
# TOON format (LLM-optimized lightweight format)
# ---------------------------------------------------------------------------


def _print_toon(
    payload: dict[str, Any],
    columns: list[str] | None,
    rows: list[dict[str, Any]] | None,
) -> None:
    """Print in TOON format using the toons library.

    TOON (Token-Oriented Object Notation) is designed for LLM consumption:
    - 30-60% fewer tokens than JSON
    - Human-readable and easy to parse
    - Optimized for structured data
    """
    if not TOONS_AVAILABLE:
        # Fallback to JSON if toons library is not available
        print(_json_dumps(payload))
        return

    # Use toons library to serialize the payload
    try:
        toon_output = toons.dumps(payload)
        print(toon_output)
    except Exception:
        # Fallback to JSON on error
        print(_json_dumps(payload))


def _print_toon_from_data(payload: dict[str, Any]) -> None:
    """Render data as TOON format."""
    _print_toon(payload, None, None)
