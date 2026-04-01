"""clickzetta sql command — execute SQL with safety guardrails."""

from __future__ import annotations

import re
import sys
import time
import traceback
from typing import Any

import click

from cz_cli import output
from cz_cli.connection import get_connection
from cz_cli.logger import log_operation
from cz_cli.masking import mask_rows

_WRITE_RE = re.compile(
    r"^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE|RENAME|FORK)\b",
    re.I,
)
_SELECT_RE = re.compile(r"^\s*SELECT\b", re.I)
_LIMIT_RE = re.compile(r"\bLIMIT\s+\d+", re.I)

_TABLE_NOT_FOUND_RE = re.compile(r"Table.*?not found", re.I)
_COLUMN_NOT_FOUND_RE = re.compile(r"(Unknown column|Column.*?not found)", re.I)
_TABLE_FROM_SQL_RE = re.compile(
    r"\b(?:FROM|INTO|UPDATE|TABLE)\s+(?:[\w.]+\.)?(\w+)", re.I
)

ROW_PROBE_LIMIT = 101
DEFAULT_TRUNCATE_LEN = 3000


def _split_sql_statements(sql: str) -> list[str]:
    """Split *sql* on semicolons outside '...', \"...\", and `...`."""
    text = sql.strip()
    if not text:
        return []
    parts: list[str] = []
    buf: list[str] = []
    n = len(text)
    i = 0
    in_single = in_double = in_backtick = False

    def flush() -> None:
        s = "".join(buf).strip()
        buf.clear()
        if s:
            parts.append(s)

    while i < n:
        c = text[i]
        if in_backtick:
            buf.append(c)
            if c == "`":
                in_backtick = False
            i += 1
            continue
        if in_single:
            buf.append(c)
            if c == "'":
                if i + 1 < n and text[i + 1] == "'":
                    buf.append(text[i + 1])
                    i += 2
                    continue
                in_single = False
            i += 1
            continue
        if in_double:
            buf.append(c)
            if c == '"':
                in_double = False
            elif c == "\\" and i + 1 < n:
                buf.append(text[i + 1])
                i += 2
                continue
            i += 1
            continue
        if c == "'":
            in_single = True
            buf.append(c)
        elif c == '"':
            in_double = True
            buf.append(c)
        elif c == "`":
            in_backtick = True
            buf.append(c)
        elif c == ";":
            flush()
        else:
            buf.append(c)
        i += 1
    flush()
    return parts if parts else [text]


def _is_write(sql: str) -> bool:
    return bool(_WRITE_RE.match(sql))


def _is_select(sql: str) -> bool:
    return bool(_SELECT_RE.match(sql))


def _has_limit(sql: str) -> bool:
    return bool(_LIMIT_RE.search(sql))


def _has_where(sql: str) -> bool:
    return bool(re.search(r"\bWHERE\b", sql, re.I))


def _check_dangerous_write(sql: str, fmt: str) -> None:
    """Reject DELETE/UPDATE without WHERE."""
    stripped = sql.strip().rstrip(";")
    if re.match(r"^\s*DELETE\b", stripped, re.I) and not _has_where(stripped):
        output.error(
            "DANGEROUS_WRITE",
            "DELETE without WHERE clause is not allowed.",
            fmt=fmt,
        )
    if re.match(r"^\s*UPDATE\b", stripped, re.I) and not _has_where(stripped):
        output.error(
            "DANGEROUS_WRITE",
            "UPDATE without WHERE clause is not allowed.",
            fmt=fmt,
        )


def _truncate_large_fields(
    rows: list[dict[str, Any]],
    max_len: int,
) -> list[dict[str, Any]]:
    """Truncate large string fields exceeding max_len characters."""
    for row in rows:
        for key, val in row.items():
            if isinstance(val, (str, bytes)):
                s = val if isinstance(val, str) else val.decode("utf-8", errors="replace")
                if len(s) > max_len:
                    row[key] = s[:max_len] + f"...(truncated, {len(s)} chars)"
    return rows


def _extract_limit_value(sql: str) -> int | None:
    """Extract LIMIT value from SQL."""
    match = _LIMIT_RE.search(sql)
    if match:
        # Extract the number from "LIMIT 100"
        limit_str = match.group(0)
        num_str = limit_str.split()[-1]
        try:
            return int(num_str)
        except ValueError:
            return None
    return None


def _replace_limit_value(sql: str, new_limit: int) -> str:
    """Replace LIMIT value in SQL."""
    return _LIMIT_RE.sub(f"LIMIT {new_limit}", sql)


def _fetch_error_schema(
    conn: Any,
    error_msg: str,
    sql: str,
) -> dict[str, Any] | None:
    """Build a schema hint dict based on the SQL error type."""
    try:
        table_match = _TABLE_NOT_FOUND_RE.search(error_msg)
        if table_match:
            cursor = conn.cursor()
            try:
                cursor.execute("SHOW TABLES")
                tables = [list(r.values())[0] for r in cursor.fetchall()]
                return {"tables": tables}
            finally:
                cursor.close()

        col_match = _COLUMN_NOT_FOUND_RE.search(error_msg)
        if col_match:
            table_names = _extract_tables_from_sql(sql)
            if table_names:
                table = table_names[0]
                cursor = conn.cursor()
                try:
                    cursor.execute(f"DESC TABLE {table}")
                    cols = [r.get("col_name", r.get("Field", "")) for r in cursor.fetchall()]
                    return {"table": table, "columns": cols}
                finally:
                    cursor.close()
    except Exception:
        pass
    return None


def _fetch_table_schema(
    conn: Any,
    table: str,
) -> dict[str, Any] | None:
    """Fetch schema for --with-schema."""
    try:
        cursor = conn.cursor()
        try:
            cursor.execute(f"DESC TABLE {table}")
            columns = [
                {"name": r.get("col_name", ""), "type": r.get("data_type", ""), "comment": r.get("comment", "")}
                for r in cursor.fetchall()
            ]
            return {"table": table, "columns": columns}
        finally:
            cursor.close()
    except Exception:
        return None


@click.command(
    "sql",
    epilog=(
        "Shell (bash): double-quoted SQL containing '!' is expanded by history before "
        "clickzetta runs (event not found). Use single quotes around the SQL, pipe or redirect "
        "into this command (stdin is read automatically when piped), --file, or run: set +H\n\n"
        "Multiple statements separated by ';' run on one connection. "
        "Output shows the last statement that returns a result set (e.g. SET ...; SELECT ...)."
    ),
)
@click.argument("statement", required=False)
@click.option("--write", is_flag=True, help="Allow write operations (INSERT/UPDATE/DELETE).")
@click.option("--with-schema", is_flag=True, help="Include related table schema in output.")
@click.option("--no-truncate", is_flag=True, help="Do not truncate large fields.")
@click.option("-f", "--file", "sql_file", type=click.Path(exists=True), help="Read SQL from file.")
@click.option("-e", "--execute", "statement_alias", help="Execute SQL (alias for positional argument).")
@click.option(
    "--stdin",
    "use_stdin",
    is_flag=True,
    help="Read SQL from stdin (also implied when stdin is a pipe/redirect and no statement).",
)
@click.option("--async", "async_exec", is_flag=True, help="Execute asynchronously with auto-polling.")
@click.option("--timeout", type=int, help="Query timeout in seconds.")
@click.option("--variable", multiple=True, help="Variable substitution KEY=VALUE (pyformat style).")
@click.option("--set", "sql_flags", multiple=True, help="Set ClickZetta SQL flag KEY=VALUE (e.g., cz.sql.result.row.partial.limit=200).")
@click.option("--job-profile", "job_id", help="Get job profile for a query ID.")
@click.option("-N", "--no-header", is_flag=True, help="Do not display column names.")
@click.option("-B", "--batch", is_flag=True, help="Batch mode (tab-separated, no header).")
@click.pass_context
def sql_cmd(
    ctx: click.Context,
    statement: str | None,
    write: bool,
    with_schema: bool,
    no_truncate: bool,
    sql_file: str | None,
    statement_alias: str | None,
    use_stdin: bool,
    async_exec: bool,
    timeout: int | None,
    variable: tuple[str, ...],
    sql_flags: tuple[str, ...],
    job_id: str | None,
    no_header: bool,
    batch: bool,
) -> None:
    """Execute a SQL statement.

    Note: --output and connection options are global; put them before the subcommand, e.g.:
      clickzetta --output json sql "SELECT * FROM t LIMIT 5"

    If you omit STATEMENT and stdin is not a terminal (pipe or redirect), SQL is read
    from stdin so literals with '!' are not mangled by the shell.
    """
    fmt: str = ctx.obj["format"]
    profile: str | None = ctx.obj.get("profile")
    jdbc_url: str | None = ctx.obj.get("jdbc_url")
    debug: bool = ctx.obj.get("debug", False)

    # Handle job profile query
    if job_id:
        _get_job_profile(profile, jdbc_url, job_id, fmt)
        return

    # Resolve SQL text
    sql_text = _resolve_sql(statement or statement_alias, sql_file, use_stdin, fmt)

    # Parse variables
    variables = {}
    for var in variable:
        if "=" in var:
            key, value = var.split("=", 1)
            variables[key] = value

    # Parse SQL flags
    flags = {}
    for flag in sql_flags:
        if "=" in flag:
            key, value = flag.split("=", 1)
            flags[key] = value

    # Check write protection
    if _is_write(sql_text) and not write:
        log_operation("sql", sql=sql_text, ok=False, error_code="WRITE_NOT_ALLOWED")
        output.error(
            "WRITE_NOT_ALLOWED",
            "Write operations require --write flag.",
            fmt=fmt,
        )

    if write and _is_write(sql_text):
        _check_dangerous_write(sql_text, fmt)

    # Get connection
    try:
        conn = get_connection(jdbc_url=jdbc_url, profile=profile)
    except Exception as exc:
        log_operation("sql", sql=sql_text, ok=False, error_code="CONNECTION_ERROR")
        err_msg = str(exc)
        if debug:
            err_msg += f"\n\n{traceback.format_exc()}"
        output.error("CONNECTION_ERROR", err_msg, fmt=fmt)
        return

    timer = output.Timer()
    try:
        with timer:
            if async_exec:
                _execute_async(conn, sql_text, fmt, no_truncate, with_schema, timer, timeout, variables, flags, no_header, batch, debug)
            else:
                _execute(conn, sql_text, fmt, no_truncate, with_schema, timer, timeout, variables, flags, no_header, batch, debug)
    except SystemExit:
        raise
    except Exception as exc:
        log_operation("sql", sql=sql_text, ok=False, error_code="INTERNAL_ERROR")
        err_msg = str(exc)
        if debug:
            err_msg += f"\n\n{traceback.format_exc()}"
        output.error("INTERNAL_ERROR", err_msg, fmt=fmt)
    finally:
        conn.close()


def _resolve_sql(
    statement: str | None,
    sql_file: str | None,
    use_stdin: bool,
    fmt: str,
) -> str:
    if sql_file:
        with open(sql_file, "r", encoding="utf-8") as f:
            return f.read().strip()
    if use_stdin:
        return sys.stdin.read().strip()
    if statement:
        return statement.strip()
    if not sys.stdin.isatty():
        piped = sys.stdin.read().strip()
        if piped:
            return piped
    output.error(
        "MISSING_SQL",
        "No SQL provided. Pass a statement, -e, --file, --stdin, or pipe SQL on stdin.",
        fmt=fmt,
        exit_code=output.EXIT_USAGE_ERROR,
    )
    return ""


def _execute(
    conn: Any,
    sql_text: str,
    fmt: str,
    no_truncate: bool,
    with_schema: bool,
    timer: output.Timer,
    timeout: int | None,
    variables: dict[str, str],
    flags: dict[str, str],
    no_header: bool,
    batch: bool,
    debug: bool = False,
) -> None:
    statements = _split_sql_statements(sql_text)
    multi_stmt = len(statements) > 1
    is_select = _is_select(sql_text)
    needs_probe = is_select and not _has_limit(sql_text) and not multi_stmt

    # For SELECT with LIMIT, probe with LIMIT+1 to detect truncation
    user_limit = None
    has_user_limit = is_select and _has_limit(sql_text) and not multi_stmt
    if has_user_limit:
        user_limit = _extract_limit_value(sql_text)

    # Prepare hints
    hints = {}
    if timeout:
        hints['sdk.job.timeout'] = timeout

    try:
        cursor = conn.cursor()
        try:
            # Set user-provided SQL flags
            for key, value in flags.items():
                cursor.execute(f"SET {key}={value}")

            # Set row limit for safety (can be overridden by --set)
            if is_select and not multi_stmt and "cz.sql.result.row.partial.limit" not in flags:
                cursor.execute("SET cz.sql.result.row.partial.limit=100")

            last_description: tuple | None = None
            rows_raw: list[Any] = []
            total_affected = 0

            for stmt in statements:
                exec_stmt = stmt
                if len(statements) == 1 and needs_probe:
                    exec_stmt = stmt.rstrip(";") + f" LIMIT {ROW_PROBE_LIMIT}"
                elif len(statements) == 1 and has_user_limit and user_limit:
                    # Probe with LIMIT+1 to detect truncation
                    exec_stmt = _replace_limit_value(stmt, user_limit + 1)

                # Apply variable substitution
                if variables:
                    exec_stmt = exec_stmt % variables

                # Execute with hints
                if hints:
                    cursor.execute(exec_stmt, hints=hints)
                else:
                    cursor.execute(exec_stmt)

                if cursor.description is not None:
                    last_description = cursor.description
                    # Convert tuples to dicts
                    columns = [d[0] for d in cursor.description]
                    rows_raw = [dict(zip(columns, row)) for row in cursor.fetchall()]
                else:
                    rc = cursor.rowcount
                    if rc is not None and rc >= 0:
                        total_affected += rc

            if last_description is not None:
                description = last_description

                if needs_probe and len(rows_raw) > ROW_PROBE_LIMIT - 1:
                    tables = _extract_tables_from_sql(sql_text)
                    extra: dict[str, Any] = {}
                    if tables:
                        schema = _fetch_table_schema(conn, tables[0])
                        if schema:
                            extra["schema"] = schema
                    log_operation(
                        "sql", sql=sql_text, ok=False, error_code="LIMIT_REQUIRED",
                        time_ms=timer.elapsed_ms,
                    )
                    output.error(
                        "LIMIT_REQUIRED",
                        "Query returns more than 100 rows. Please add LIMIT to your SQL.",
                        fmt=fmt,
                        extra=extra or None,
                    )

                columns = [d[0] for d in description]
                rows = rows_raw

                # Check if user's LIMIT was hit
                ai_msg = None
                if has_user_limit and user_limit and len(rows) > user_limit:
                    # Truncate to user's limit
                    rows = rows[:user_limit]
                    ai_msg = f"Results limited to {user_limit} rows (more data available). Increase LIMIT to see more."

                if not no_truncate:
                    rows = _truncate_large_fields(rows, DEFAULT_TRUNCATE_LEN)

                rows = mask_rows(columns, rows)

                extra_out: dict[str, Any] = {}
                # Add job_id if available
                if hasattr(cursor, 'job_id') and cursor.job_id:
                    extra_out["job_id"] = cursor.job_id
                if with_schema:
                    tables = _extract_tables_from_sql(sql_text)
                    if tables:
                        schema = _fetch_table_schema(conn, tables[0])
                        if schema:
                            extra_out["schema"] = schema

                # Handle batch mode
                if batch or no_header:
                    if batch:
                        fmt = "text"
                    # Suppress header in output
                    ctx_obj = {"no_header": True}
                else:
                    ctx_obj = {}

                log_operation(
                    "sql", sql=sql_text, ok=True, rows=len(rows),
                    time_ms=timer.elapsed_ms,
                )
                output.success_rows(
                    columns, rows,
                    affected=total_affected,
                    time_ms=timer.elapsed_ms,
                    fmt=fmt,
                    extra=extra_out or None,
                    ai_message=ai_msg,
                )
            else:
                extra_out: dict[str, Any] = {}
                # Add job_id if available
                if hasattr(cursor, 'job_id') and cursor.job_id:
                    extra_out["job_id"] = cursor.job_id

                log_operation(
                    "sql", sql=sql_text, ok=True, affected=total_affected,
                    time_ms=timer.elapsed_ms,
                )
                output.success(
                    {"affected": total_affected},
                    time_ms=timer.elapsed_ms,
                    fmt=fmt,
                    extra=extra_out or None,
                )
        finally:
            cursor.close()

    except Exception as exc:
        err_msg = str(exc)
        schema_hint = _fetch_error_schema(conn, err_msg, sql_text)
        extra_err: dict[str, Any] = {}
        if schema_hint:
            extra_err["schema"] = schema_hint
        if debug:
            err_msg += f"\n\n{traceback.format_exc()}"
        log_operation(
            "sql", sql=sql_text, ok=False, error_code="SQL_ERROR",
            time_ms=timer.elapsed_ms,
        )
        output.error("SQL_ERROR", err_msg, fmt=fmt, extra=extra_err or None)


def _execute_async(
    conn: Any,
    sql_text: str,
    fmt: str,
    no_truncate: bool,
    with_schema: bool,
    timer: output.Timer,
    timeout: int | None,
    variables: dict[str, str],
    flags: dict[str, str],
    no_header: bool,
    batch: bool,
    debug: bool = False,
) -> None:
    """Execute SQL asynchronously with auto-polling."""
    hints = {}
    if timeout:
        hints['sdk.job.timeout'] = timeout

    try:
        cursor = conn.cursor()
        try:
            # Set user-provided SQL flags
            for key, value in flags.items():
                cursor.execute(f"SET {key}={value}")

            # Apply variable substitution
            exec_sql = sql_text
            if variables:
                exec_sql = exec_sql % variables

            # Execute async
            if hints:
                cursor.execute_async(exec_sql, hints=hints)
            else:
                cursor.execute_async(exec_sql)

            job_id = cursor.job_id

            # Poll until finished
            poll_interval = 0.5
            while not cursor.is_job_finished():
                time.sleep(poll_interval)

            # Fetch results
            if cursor.description is not None:
                columns = [d[0] for d in cursor.description]
                # Convert tuples to dicts
                rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

                if not no_truncate:
                    rows = _truncate_large_fields(rows, DEFAULT_TRUNCATE_LEN)

                rows = mask_rows(columns, rows)

                extra_out: dict[str, Any] = {"job_id": job_id}
                if with_schema:
                    tables = _extract_tables_from_sql(sql_text)
                    if tables:
                        schema = _fetch_table_schema(conn, tables[0])
                        if schema:
                            extra_out["schema"] = schema

                log_operation(
                    "sql", sql=sql_text, ok=True, rows=len(rows),
                    time_ms=timer.elapsed_ms,
                )
                output.success_rows(
                    columns, rows,
                    time_ms=timer.elapsed_ms,
                    fmt=fmt,
                    extra=extra_out or None,
                )
            else:
                log_operation(
                    "sql", sql=sql_text, ok=True,
                    time_ms=timer.elapsed_ms,
                )
                output.success(
                    {"job_id": job_id, "message": "Query executed successfully"},
                    time_ms=timer.elapsed_ms,
                    fmt=fmt,
                )
        finally:
            cursor.close()

    except Exception as exc:
        err_msg = str(exc)
        if debug:
            err_msg += f"\n\n{traceback.format_exc()}"
        log_operation(
            "sql", sql=sql_text, ok=False, error_code="SQL_ERROR",
            time_ms=timer.elapsed_ms,
        )
        output.error("SQL_ERROR", err_msg, fmt=fmt)


def _get_job_profile(
    profile: str | None,
    jdbc_url: str | None,
    job_id: str,
    fmt: str,
) -> None:
    """Get job profile/summary for a query ID."""
    try:
        conn = get_connection(jdbc_url=jdbc_url, profile=profile)
    except Exception as exc:
        log_operation("sql job-profile", ok=False, error_code="CONNECTION_ERROR")
        output.error("CONNECTION_ERROR", str(exc), fmt=fmt)
        return

    try:
        summary = conn.get_job_summary(job_id)
        log_operation("sql job-profile", ok=True)
        output.success(summary, fmt=fmt)
    except Exception as exc:
        log_operation("sql job-profile", ok=False, error_code="JOB_PROFILE_ERROR")
        output.error("JOB_PROFILE_ERROR", str(exc), fmt=fmt)
    finally:
        conn.close()


@click.command("status")
@click.argument("job_id")
@click.pass_context
def sql_status_cmd(ctx: click.Context, job_id: str) -> None:
    """Check status of an async SQL job."""
    fmt: str = ctx.obj["format"]
    profile: str | None = ctx.obj.get("profile")
    jdbc_url: str | None = ctx.obj.get("jdbc_url")

    _get_job_profile(profile, jdbc_url, job_id, fmt)
