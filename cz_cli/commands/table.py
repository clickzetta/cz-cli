"""clickzetta table command — manage tables."""

from __future__ import annotations

from typing import Any

import click

from cz_cli import output
from cz_cli.cli_group import CLIGroup
from cz_cli.connection import get_connection
from cz_cli.connection_ctx import connection_kwargs_from_ctx
from cz_cli.logger import log_operation


@click.group("table", cls=CLIGroup)
@click.pass_context
def table_cmd(ctx: click.Context) -> None:
    """Manage tables."""


@table_cmd.command("list")
@click.option("--like", help="Filter tables by pattern (e.g. 'test%').")
@click.option("--schema", help="Specify schema name.")
@click.option("--limit", default=100, help="Maximum number of tables to return (default: 100).")
@click.pass_context
def list_tables(ctx: click.Context, like: str | None, schema: str | None, limit: int) -> None:
    """List all tables in the current or specified schema."""
    fmt: str = ctx.obj.get("format", "json")
    profile: str | None = ctx.obj.get("profile")
    jdbc_url: str | None = ctx.obj.get("jdbc_url")

    try:
        conn = get_connection(jdbc_url=jdbc_url, profile=profile, **connection_kwargs_from_ctx(ctx))
    except Exception as exc:
        log_operation("table list", ok=False, error_code="CONNECTION_ERROR")
        output.error("CONNECTION_ERROR", str(exc), fmt=fmt)
        return

    timer = output.Timer()
    try:
        with timer:
            cursor = conn.cursor()
            try:
                # Build SQL
                if schema:
                    sql = f"SHOW TABLES IN {schema}"
                else:
                    sql = "SHOW TABLES"

                if like:
                    sql += f" LIKE '{like}'"

                # Probe with LIMIT+1 to detect truncation
                sql += f" LIMIT {limit + 1}"

                cursor.execute(sql)
                rows = cursor.fetchall()

                # Convert tuples to dicts
                columns = [d[0] for d in cursor.description] if cursor.description else []
                result = []
                for row in rows:
                    if isinstance(row, tuple):
                        row_dict = dict(zip(columns, row))
                        table_name = row_dict.get(
                            "table_name", row_dict.get("name", row_dict.get(columns[0], ""))
                        )
                    elif isinstance(row, dict):
                        table_name = row.get(
                            "table_name", row.get("name", list(row.values())[0] if row else "")
                        )
                    else:
                        table_name = str(row)
                    result.append({"name": table_name})

                # Check if results were truncated
                ai_msg = None
                if len(result) > limit:
                    result = result[:limit]
                    ai_msg = f"Results limited to {limit} tables (more available). Use --limit to adjust or --like to filter."

                log_operation("table list", ok=True, time_ms=timer.elapsed_ms)
                output.success(result, time_ms=timer.elapsed_ms, fmt=fmt, ai_message=ai_msg)
            finally:
                cursor.close()
    except Exception as exc:
        log_operation("table list", ok=False, error_code="SQL_ERROR")
        output.error("SQL_ERROR", str(exc), fmt=fmt)
    finally:
        conn.close()


@table_cmd.command("describe")
@click.argument("name")
@click.pass_context
def describe_table(ctx: click.Context, name: str) -> None:
    """Show table structure including columns and metadata."""
    fmt: str = ctx.obj.get("format", "json")
    profile: str | None = ctx.obj.get("profile")
    jdbc_url: str | None = ctx.obj.get("jdbc_url")

    try:
        conn = get_connection(jdbc_url=jdbc_url, profile=profile, **connection_kwargs_from_ctx(ctx))
    except Exception as exc:
        log_operation("table describe", ok=False, error_code="CONNECTION_ERROR")
        output.error("CONNECTION_ERROR", str(exc), fmt=fmt)
        return

    timer = output.Timer()
    try:
        with timer:
            cursor = conn.cursor()
            try:
                cursor.execute(f"DESC TABLE {name}")
                rows = cursor.fetchall()

                # Convert tuples to dicts
                columns_desc = [d[0] for d in cursor.description] if cursor.description else []
                rows_dict = [
                    dict(zip(columns_desc, row)) if isinstance(row, tuple) else row for row in rows
                ]

                columns = []
                metadata = {}
                in_metadata = False

                for row in rows_dict:
                    col_name = row.get("column_name", row.get("col_name", ""))

                    # Check if we've reached metadata section
                    if col_name == "# detailed table information" or col_name == "":
                        in_metadata = True
                        continue

                    if in_metadata:
                        # This is metadata
                        data_type = row.get("data_type", "")
                        if col_name and data_type:
                            metadata[col_name] = data_type
                    else:
                        # This is a column
                        columns.append(
                            {
                                "name": col_name,
                                "type": row.get("data_type", ""),
                                "comment": row.get("comment", ""),
                            }
                        )

                result: dict[str, Any] = {
                    "table": name,
                    "columns": columns,
                }
                if metadata:
                    result["metadata"] = metadata

                log_operation("table describe", ok=True, time_ms=timer.elapsed_ms)
                output.success(result, time_ms=timer.elapsed_ms, fmt=fmt)
            finally:
                cursor.close()
    except Exception as exc:
        log_operation("table describe", ok=False, error_code="SQL_ERROR")
        output.error("SQL_ERROR", str(exc), fmt=fmt)
    finally:
        conn.close()


@table_cmd.command("preview")
@click.argument("name")
@click.option("--limit", default=10, help="Number of rows to preview (default: 10).")
@click.pass_context
def preview_table(ctx: click.Context, name: str, limit: int) -> None:
    """Preview table data."""
    fmt: str = ctx.obj.get("format", "json")
    profile: str | None = ctx.obj.get("profile")
    jdbc_url: str | None = ctx.obj.get("jdbc_url")

    try:
        conn = get_connection(jdbc_url=jdbc_url, profile=profile, **connection_kwargs_from_ctx(ctx))
    except Exception as exc:
        log_operation("table preview", ok=False, error_code="CONNECTION_ERROR")
        output.error("CONNECTION_ERROR", str(exc), fmt=fmt)
        return

    timer = output.Timer()
    try:
        with timer:
            cursor = conn.cursor()
            try:
                cursor.execute(f"SELECT * FROM {name} LIMIT {limit}")
                rows = cursor.fetchall()

                if cursor.description:
                    columns = [d[0] for d in cursor.description]
                    # Convert tuples to dicts
                    rows_dict = [
                        dict(zip(columns, row)) if isinstance(row, tuple) else row for row in rows
                    ]
                    log_operation(
                        "table preview", ok=True, rows=len(rows_dict), time_ms=timer.elapsed_ms
                    )
                    output.success_rows(columns, rows_dict, time_ms=timer.elapsed_ms, fmt=fmt)
                else:
                    log_operation("table preview", ok=True, time_ms=timer.elapsed_ms)
                    output.success({"message": "No data"}, time_ms=timer.elapsed_ms, fmt=fmt)
            finally:
                cursor.close()
    except Exception as exc:
        log_operation("table preview", ok=False, error_code="SQL_ERROR")
        output.error("SQL_ERROR", str(exc), fmt=fmt)
    finally:
        conn.close()


@table_cmd.command("stats")
@click.argument("name")
@click.pass_context
def table_stats(ctx: click.Context, name: str) -> None:
    """Show table statistics using job summary."""
    fmt: str = ctx.obj.get("format", "json")
    profile: str | None = ctx.obj.get("profile")
    jdbc_url: str | None = ctx.obj.get("jdbc_url")

    try:
        conn = get_connection(jdbc_url=jdbc_url, profile=profile, **connection_kwargs_from_ctx(ctx))
    except Exception as exc:
        log_operation("table stats", ok=False, error_code="CONNECTION_ERROR")
        output.error("CONNECTION_ERROR", str(exc), fmt=fmt)
        return

    timer = output.Timer()
    try:
        with timer:
            cursor = conn.cursor()
            try:
                # Execute a simple query to get job_id
                cursor.execute(f"SELECT COUNT(*) as row_count FROM {name}")
                rows = cursor.fetchall()

                # Convert tuple to dict
                if rows and cursor.description:
                    columns = [d[0] for d in cursor.description]
                    row_dict = (
                        dict(zip(columns, rows[0])) if isinstance(rows[0], tuple) else rows[0]
                    )
                    row_count = row_dict.get("row_count", 0)
                else:
                    row_count = 0

                job_id = cursor.job_id

                # Get job summary
                summary = conn.get_job_summary(job_id)

                result = {
                    "table": name,
                    "row_count": row_count,
                    "job_summary": summary,
                }

                log_operation("table stats", ok=True, time_ms=timer.elapsed_ms)
                output.success(result, time_ms=timer.elapsed_ms, fmt=fmt)
            finally:
                cursor.close()
    except Exception as exc:
        log_operation("table stats", ok=False, error_code="SQL_ERROR")
        output.error("SQL_ERROR", str(exc), fmt=fmt)
    finally:
        conn.close()


@table_cmd.command("history")
@click.argument("name", required=False)
@click.option("--schema", help="Specify schema name.")
@click.option("--like", help="Filter by pattern.")
@click.option("--limit", default=100, help="Maximum number of results to return (default: 100).")
@click.pass_context
def table_history(
    ctx: click.Context, name: str | None, schema: str | None, like: str | None, limit: int
) -> None:
    """Show table history including deleted tables."""
    fmt: str = ctx.obj.get("format", "json")
    profile: str | None = ctx.obj.get("profile")
    jdbc_url: str | None = ctx.obj.get("jdbc_url")

    try:
        conn = get_connection(jdbc_url=jdbc_url, profile=profile, **connection_kwargs_from_ctx(ctx))
    except Exception as exc:
        log_operation("table history", ok=False, error_code="CONNECTION_ERROR")
        output.error("CONNECTION_ERROR", str(exc), fmt=fmt)
        return

    timer = output.Timer()
    try:
        with timer:
            cursor = conn.cursor()
            try:
                sql = "SHOW TABLES HISTORY"

                if schema:
                    sql += f" IN {schema}"

                if like:
                    sql += f" LIKE '{like}'"
                elif name:
                    sql += f" LIKE '{name}'"

                # Probe with LIMIT+1 to detect truncation
                sql += f" LIMIT {limit + 1}"

                cursor.execute(sql)
                rows = cursor.fetchall()

                # Convert tuples to dicts
                columns = [d[0] for d in cursor.description] if cursor.description else []
                rows_dict = [
                    dict(zip(columns, row)) if isinstance(row, tuple) else row for row in rows
                ]

                result = []
                for row in rows_dict:
                    result.append(
                        {
                            "schema": row.get("schema_name", ""),
                            "table": row.get("table_name", ""),
                            "create_time": row.get("create_time", ""),
                            "creator": row.get("creator", ""),
                            "rows": row.get("rows", 0),
                            "bytes": row.get("bytes", 0),
                            "delete_time": row.get("delete_time", ""),
                        }
                    )

                # Check if results were truncated
                ai_msg = None
                if len(result) > limit:
                    result = result[:limit]
                    ai_msg = f"Results limited to {limit} records (more available). Use --limit to adjust or --like/--schema to filter."

                log_operation("table history", ok=True, time_ms=timer.elapsed_ms)
                output.success(result, time_ms=timer.elapsed_ms, fmt=fmt, ai_message=ai_msg)
            finally:
                cursor.close()
    except Exception as exc:
        log_operation("table history", ok=False, error_code="SQL_ERROR")
        output.error("SQL_ERROR", str(exc), fmt=fmt)
    finally:
        conn.close()


@table_cmd.command("create")
@click.argument("ddl", required=False)
@click.option("--from-file", type=click.Path(exists=True), help="Read DDL from file.")
@click.pass_context
def create_table(ctx: click.Context, ddl: str | None, from_file: str | None) -> None:
    """Create a table from DDL."""
    fmt: str = ctx.obj.get("format", "json")
    profile: str | None = ctx.obj.get("profile")
    jdbc_url: str | None = ctx.obj.get("jdbc_url")

    # Resolve DDL
    if from_file:
        with open(from_file, "r", encoding="utf-8") as f:
            ddl = f.read().strip()
    elif not ddl:
        output.error("MISSING_DDL", "Provide DDL as argument or use --from-file", fmt=fmt)
        return

    try:
        conn = get_connection(jdbc_url=jdbc_url, profile=profile, **connection_kwargs_from_ctx(ctx))
    except Exception as exc:
        log_operation("table create", ok=False, error_code="CONNECTION_ERROR")
        output.error("CONNECTION_ERROR", str(exc), fmt=fmt)
        return

    timer = output.Timer()
    try:
        with timer:
            cursor = conn.cursor()
            try:
                cursor.execute(ddl)
                log_operation("table create", ok=True, time_ms=timer.elapsed_ms)
                output.success(
                    {"message": "Table created successfully"}, time_ms=timer.elapsed_ms, fmt=fmt
                )
            finally:
                cursor.close()
    except Exception as exc:
        log_operation("table create", ok=False, error_code="SQL_ERROR")
        output.error("SQL_ERROR", str(exc), fmt=fmt)
    finally:
        conn.close()


@table_cmd.command("drop")
@click.argument("name")
@click.pass_context
def drop_table(ctx: click.Context, name: str) -> None:
    """Drop a table."""
    fmt: str = ctx.obj.get("format", "json")
    profile: str | None = ctx.obj.get("profile")
    jdbc_url: str | None = ctx.obj.get("jdbc_url")

    try:
        conn = get_connection(jdbc_url=jdbc_url, profile=profile, **connection_kwargs_from_ctx(ctx))
    except Exception as exc:
        log_operation("table drop", ok=False, error_code="CONNECTION_ERROR")
        output.error("CONNECTION_ERROR", str(exc), fmt=fmt)
        return

    timer = output.Timer()
    try:
        with timer:
            cursor = conn.cursor()
            try:
                cursor.execute(f"DROP TABLE {name}")
                log_operation("table drop", ok=True, time_ms=timer.elapsed_ms)
                output.success(
                    {"message": f"Table '{name}' dropped successfully"},
                    time_ms=timer.elapsed_ms,
                    fmt=fmt,
                )
            finally:
                cursor.close()
    except Exception as exc:
        log_operation("table drop", ok=False, error_code="SQL_ERROR")
        output.error("SQL_ERROR", str(exc), fmt=fmt)
    finally:
        conn.close()
