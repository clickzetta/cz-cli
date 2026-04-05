"""clickzetta schema command — manage schemas."""

from __future__ import annotations

from typing import Any

import click

from cz_cli import output
from cz_cli.cli_group import CLIGroup
from cz_cli.connection import get_connection
from cz_cli.connection_ctx import connection_kwargs_from_ctx
from cz_cli.logger import log_operation


@click.group("schema", cls=CLIGroup)
@click.pass_context
def schema_cmd(ctx: click.Context) -> None:
    """Manage schemas."""


@schema_cmd.command("list")
@click.option("--like", help="Filter schemas by pattern (e.g. 'test%').")
@click.option("--limit", default=100, help="Maximum number of schemas to return (default: 100).")
@click.pass_context
def list_schemas(ctx: click.Context, like: str | None, limit: int) -> None:
    """List all schemas in the current workspace."""
    fmt: str = ctx.obj.get("format", "json")
    profile: str | None = ctx.obj.get("profile")
    jdbc_url: str | None = ctx.obj.get("jdbc_url")

    try:
        conn = get_connection(jdbc_url=jdbc_url, profile=profile, **connection_kwargs_from_ctx(ctx))
    except Exception as exc:
        log_operation("schema list", ok=False, error_code="CONNECTION_ERROR")
        output.error("CONNECTION_ERROR", str(exc), fmt=fmt)
        return

    timer = output.Timer()
    try:
        with timer:
            cursor = conn.cursor()
            try:
                sql = "SHOW SCHEMAS"
                if like:
                    sql += f" LIKE '{like}'"
                # Note: SHOW SCHEMAS does not support LIMIT clause, we'll limit client-side

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
                            "name": row.get(
                                "schema_name",
                                row.get("name", row.get(columns[0], "") if columns else ""),
                            ),
                            "type": row.get("type", ""),
                        }
                    )

                # Client-side limit (SHOW SCHEMAS doesn't support LIMIT clause)
                total_count = len(result)
                if total_count > limit:
                    result = result[:limit]

                # Add AI message if results were limited
                ai_msg = None
                if total_count > limit:
                    ai_msg = f"Results limited to {limit} of {total_count} schemas. Use --limit to adjust or --like to filter."

                log_operation("schema list", ok=True, time_ms=timer.elapsed_ms)
                output.success(result, time_ms=timer.elapsed_ms, fmt=fmt, ai_message=ai_msg)
            finally:
                cursor.close()
    except Exception as exc:
        log_operation("schema list", ok=False, error_code="SQL_ERROR")
        output.error("SQL_ERROR", str(exc), fmt=fmt)
    finally:
        conn.close()


@schema_cmd.command("describe")
@click.argument("name")
@click.pass_context
def describe_schema(ctx: click.Context, name: str) -> None:
    """Show schema details including tables."""
    fmt: str = ctx.obj.get("format", "json")
    profile: str | None = ctx.obj.get("profile")
    jdbc_url: str | None = ctx.obj.get("jdbc_url")

    try:
        conn = get_connection(jdbc_url=jdbc_url, profile=profile, **connection_kwargs_from_ctx(ctx))
    except Exception as exc:
        log_operation("schema describe", ok=False, error_code="CONNECTION_ERROR")
        output.error("CONNECTION_ERROR", str(exc), fmt=fmt)
        return

    timer = output.Timer()
    try:
        with timer:
            cursor = conn.cursor()
            try:
                # Get schema info
                cursor.execute(f"SHOW SCHEMAS EXTENDED WHERE schema_name='{name}'")
                schema_rows = cursor.fetchall()

                if not schema_rows:
                    log_operation("schema describe", ok=False, error_code="SCHEMA_NOT_FOUND")
                    output.error("SCHEMA_NOT_FOUND", f"Schema '{name}' not found", fmt=fmt)
                    return

                # Convert tuple to dict
                columns = [d[0] for d in cursor.description] if cursor.description else []
                schema_info = (
                    dict(zip(columns, schema_rows[0]))
                    if isinstance(schema_rows[0], tuple)
                    else schema_rows[0]
                )

                # Get tables in schema
                cursor.execute(f"SHOW TABLES IN {name}")
                table_rows = cursor.fetchall()

                # Convert tuples to dicts
                table_columns = [d[0] for d in cursor.description] if cursor.description else []
                tables = []
                for r in table_rows:
                    if isinstance(r, tuple):
                        row_dict = dict(zip(table_columns, r))
                        tables.append(row_dict.get(table_columns[0], "") if table_columns else "")
                    elif isinstance(r, dict):
                        tables.append(list(r.values())[0] if r else "")
                    else:
                        tables.append(str(r))

                result: dict[str, Any] = {
                    "name": name,
                    "type": schema_info.get("type", ""),
                    "table_count": len(tables),
                    "tables": tables,
                }

                log_operation("schema describe", ok=True, time_ms=timer.elapsed_ms)
                output.success(result, time_ms=timer.elapsed_ms, fmt=fmt)
            finally:
                cursor.close()
    except Exception as exc:
        log_operation("schema describe", ok=False, error_code="SQL_ERROR")
        output.error("SQL_ERROR", str(exc), fmt=fmt)
    finally:
        conn.close()


@schema_cmd.command("create")
@click.argument("name")
@click.pass_context
def create_schema(ctx: click.Context, name: str) -> None:
    """Create a new schema."""
    fmt: str = ctx.obj.get("format", "json")
    profile: str | None = ctx.obj.get("profile")
    jdbc_url: str | None = ctx.obj.get("jdbc_url")

    try:
        conn = get_connection(jdbc_url=jdbc_url, profile=profile, **connection_kwargs_from_ctx(ctx))
    except Exception as exc:
        log_operation("schema create", ok=False, error_code="CONNECTION_ERROR")
        output.error("CONNECTION_ERROR", str(exc), fmt=fmt)
        return

    timer = output.Timer()
    try:
        with timer:
            cursor = conn.cursor()
            try:
                cursor.execute(f"CREATE SCHEMA {name}")
                log_operation("schema create", ok=True, time_ms=timer.elapsed_ms)
                output.success(
                    {"message": f"Schema '{name}' created successfully"},
                    time_ms=timer.elapsed_ms,
                    fmt=fmt,
                )
            finally:
                cursor.close()
    except Exception as exc:
        log_operation("schema create", ok=False, error_code="SQL_ERROR")
        output.error("SQL_ERROR", str(exc), fmt=fmt)
    finally:
        conn.close()


@schema_cmd.command("drop")
@click.argument("name")
@click.pass_context
def drop_schema(ctx: click.Context, name: str) -> None:
    """Drop a schema."""
    fmt: str = ctx.obj.get("format", "json")
    profile: str | None = ctx.obj.get("profile")
    jdbc_url: str | None = ctx.obj.get("jdbc_url")

    try:
        conn = get_connection(jdbc_url=jdbc_url, profile=profile, **connection_kwargs_from_ctx(ctx))
    except Exception as exc:
        log_operation("schema drop", ok=False, error_code="CONNECTION_ERROR")
        output.error("CONNECTION_ERROR", str(exc), fmt=fmt)
        return

    timer = output.Timer()
    try:
        with timer:
            cursor = conn.cursor()
            try:
                cursor.execute(f"DROP SCHEMA {name}")
                log_operation("schema drop", ok=True, time_ms=timer.elapsed_ms)
                output.success(
                    {"message": f"Schema '{name}' dropped successfully"},
                    time_ms=timer.elapsed_ms,
                    fmt=fmt,
                )
            finally:
                cursor.close()
    except Exception as exc:
        log_operation("schema drop", ok=False, error_code="SQL_ERROR")
        output.error("SQL_ERROR", str(exc), fmt=fmt)
    finally:
        conn.close()
