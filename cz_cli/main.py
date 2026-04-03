"""cz-cli — AI-Agent-friendly CLI for ClickZetta Lakehouse."""

from __future__ import annotations

import json

import click

from cz_cli import __version__, output
from cz_cli.cli_group import CLIGroup
from cz_cli.connection import get_connection
from cz_cli.logger import log_operation


@click.group(invoke_without_command=True, cls=CLIGroup)
@click.option("--profile", "-p", help="Profile name from ~/.clickzetta/profiles.toml")
@click.option("--jdbc-url", help="JDBC connection URL (jdbc:clickzetta://...)")
@click.option("--schema", "-s", help="Default schema")
@click.option("--vcluster", "-v", help="Virtual cluster")
@click.option("--output", "-o", "fmt", type=click.Choice(["json", "table", "csv", "jsonl", "toon"]), default="json", help="Output format")
@click.option("--debug", "-d", is_flag=True, help="Enable debug mode")
@click.option("--silent", is_flag=True, help="Suppress non-essential output")
@click.option("--verbose", is_flag=True, help="Verbose output")
@click.version_option(__version__, message="version %(version)s")
@click.pass_context
def cli(
    ctx: click.Context,
    profile: str | None,
    jdbc_url: str | None,
    schema: str | None,
    vcluster: str | None,
    fmt: str,
    debug: bool,
    silent: bool,
    verbose: bool,
) -> None:
    """cz-cli — AI-Agent-friendly CLI for ClickZetta Lakehouse."""
    ctx.ensure_object(dict)
    ctx.obj["profile"] = profile
    ctx.obj["jdbc_url"] = jdbc_url
    ctx.obj["schema"] = schema
    ctx.obj["vcluster"] = vcluster
    ctx.obj["format"] = fmt
    ctx.obj["debug"] = debug
    ctx.obj["silent"] = silent
    ctx.obj["verbose"] = verbose

    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@cli.command("status")
@click.pass_context
def status_cmd(ctx: click.Context) -> None:
    """Show connection status and version info."""
    fmt: str = ctx.obj.get("format", "json")
    profile: str | None = ctx.obj.get("profile")
    jdbc_url: str | None = ctx.obj.get("jdbc_url")

    info: dict = {"cli_version": __version__}

    try:
        conn = get_connection(jdbc_url=jdbc_url, profile=profile)
    except Exception as exc:
        info["connected"] = False
        info["error"] = str(exc)
        log_operation("status", ok=False, error_code="CONNECTION_ERROR")
        output.success(info, fmt=fmt)
        return

    timer = output.Timer()
    try:
        with timer:
            cursor = conn.cursor()
            try:
                cursor.execute("SELECT current_workspace() AS workspace")
                row = cursor.fetchone()
                # Convert tuple to dict
                if row:
                    columns = [d[0] for d in cursor.description]
                    row_dict = dict(zip(columns, row))
                    info["workspace"] = row_dict.get("workspace", "unknown")
                else:
                    info["workspace"] = "unknown"

                cursor.execute("SELECT current_schema() AS schema")
                row = cursor.fetchone()
                # Convert tuple to dict
                if row:
                    columns = [d[0] for d in cursor.description]
                    row_dict = dict(zip(columns, row))
                    info["schema"] = row_dict.get("schema", "unknown")
                else:
                    info["schema"] = "unknown"

                info["connected"] = True
            finally:
                cursor.close()
    except Exception as exc:
        info["connected"] = False
        info["error"] = str(exc)
    finally:
        conn.close()

    log_operation("status", ok=info.get("connected", False), time_ms=timer.elapsed_ms)
    output.success(info, time_ms=timer.elapsed_ms, fmt=fmt)


# ---------------------------------------------------------------------------
# ai-guide — structured self-description for AI Agents
# ---------------------------------------------------------------------------

_AI_GUIDE = {
    "name": "cz-cli",
    "version": __version__,
    "description": "AI-Agent-friendly CLI for ClickZetta Lakehouse",
    "global_options": {
        "order": "Global options must appear before the subcommand.",
        "usage_pattern": "clickzetta [--profile PROFILE] [--output json|table|csv|text] <subcommand> [args]",
        "connection_methods": {
            "profile": "Use ~/.clickzetta/profiles.toml: clickzetta --profile dev sql \"SELECT 1\"",
            "jdbc_url": "Use JDBC URL: clickzetta --jdbc-url 'jdbc:clickzetta://host/instance?...' sql \"SELECT 1\"",
            "env_vars": "Set CZ_USERNAME, CZ_PASSWORD, CZ_SERVICE, CZ_INSTANCE, CZ_WORKSPACE",
        },
        "examples": [
            "clickzetta --output table sql \"SELECT * FROM t LIMIT 5\"",
            "clickzetta --profile prod status",
            "clickzetta profile create dev --username user --password pass --instance inst --workspace ws",
            "clickzetta sql -e \"SELECT 1\"",
            "clickzetta sql -f query.sql",
        ],
    },
    "recommended_workflow": [
        "clickzetta profile create <name> --username ... --password ... --instance ... --workspace ...",
        "clickzetta workspace current",
        "clickzetta schema list",
        "clickzetta table list --schema public",
        "clickzetta table describe <table>",
        "clickzetta sql \"SELECT ... LIMIT N\"",
    ],
    "commands": [
        {
            "name": "status",
            "usage": "clickzetta status",
            "description": "Show connection status, workspace, and schema.",
        },
        {
            "name": "profile list",
            "usage": "clickzetta profile list",
            "description": "List all configured profiles.",
        },
        {
            "name": "profile create",
            "usage": "clickzetta profile create <name> --username <user> --password <pass> --instance <inst> --workspace <ws>",
            "description": "Create a new connection profile.",
        },
        {
            "name": "profile update",
            "usage": "clickzetta profile update <name> <key> <value>",
            "description": "Update a profile field.",
        },
        {
            "name": "profile delete",
            "usage": "clickzetta profile delete <name>",
            "description": "Delete a profile.",
        },
        {
            "name": "profile use",
            "usage": "clickzetta profile use <name>",
            "description": "Set a profile as default.",
        },
        {
            "name": "sql",
            "usage": "clickzetta sql [<statement>] [-e <sql>] [-f <file>] [--write] [--async] [--timeout <sec>] [--variable KEY=VALUE]",
            "description": "Execute SQL. Read-only by default; add --write for mutations. Supports async execution, variable substitution, and timeout control.",
        },
        {
            "name": "sql status",
            "usage": "clickzetta sql status <job_id>",
            "description": "Check status of an async SQL job.",
        },
        {
            "name": "workspace current",
            "usage": "clickzetta workspace current",
            "description": "Show current workspace.",
        },
        {
            "name": "workspace use",
            "usage": "clickzetta workspace use <name> [--persist]",
            "description": "Switch to a workspace. Use --persist to update profile.",
        },
        {
            "name": "schema list",
            "usage": "clickzetta schema list [--like <pattern>]",
            "description": "List all schemas in the current workspace.",
        },
        {
            "name": "schema describe",
            "usage": "clickzetta schema describe <name>",
            "description": "Show schema details including tables.",
        },
        {
            "name": "schema create",
            "usage": "clickzetta schema create <name>",
            "description": "Create a new schema.",
        },
        {
            "name": "schema drop",
            "usage": "clickzetta schema drop <name>",
            "description": "Drop a schema.",
        },
        {
            "name": "table list",
            "usage": "clickzetta table list [--schema <schema>] [--like <pattern>]",
            "description": "List all tables in the current or specified schema.",
        },
        {
            "name": "table describe",
            "usage": "clickzetta table describe <name>",
            "description": "Show table structure including columns and metadata.",
        },
        {
            "name": "table preview",
            "usage": "clickzetta table preview <name> [--limit <n>]",
            "description": "Preview table data (default: 10 rows).",
        },
        {
            "name": "table stats",
            "usage": "clickzetta table stats <name>",
            "description": "Show table statistics using job summary.",
        },
        {
            "name": "table history",
            "usage": "clickzetta table history [<name>] [--schema <schema>] [--like <pattern>]",
            "description": "Show table history including deleted tables.",
        },
        {
            "name": "table create",
            "usage": "clickzetta table create [<ddl>] [--from-file <path>]",
            "description": "Create a table from DDL.",
        },
        {
            "name": "table drop",
            "usage": "clickzetta table drop <name>",
            "description": "Drop a table.",
        },
        {
            "name": "ai-guide",
            "usage": "clickzetta ai-guide",
            "description": "Output this structured guide for AI Agents (JSON).",
        },
    ],
    "output_format": {
        "success": {"ok": True, "data": "...", "time_ms": "N"},
        "error": {"ok": False, "error": {"code": "...", "message": "..."}},
    },
    "safety": {
        "row_protection": "Queries without LIMIT are limited to 100 rows via SET cz.sql.result.row.partial.limit=100.",
        "write_protection": "Write operations require --write flag. DELETE/UPDATE without WHERE are blocked.",
        "masking": "Sensitive fields (phone, email, password, id_card) are auto-masked in output.",
    },
    "exit_codes": {"0": "success", "1": "business error", "2": "usage error"},
    "tips": {
        "detailed_help": "Run 'clickzetta <subcommand> --help' for detailed options.",
        "short_options": "Use -e for --execute, -f for --file, -o for --output, -N for --no-header, -B for --batch mode.",
    },
}


@cli.command("ai-guide")
@click.pass_context
def ai_guide_cmd(ctx: click.Context) -> None:
    """Output structured AI Agent usage guide (JSON)."""
    log_operation("ai-guide", ok=True)
    print(json.dumps(_AI_GUIDE, ensure_ascii=False, indent=2))
    raise SystemExit(0)


# ---------------------------------------------------------------------------
# Register all sub-commands
# ---------------------------------------------------------------------------

from cz_cli.commands.sql import sql_cmd, sql_status_cmd  # noqa: E402
from cz_cli.commands.schema import schema_cmd  # noqa: E402
from cz_cli.commands.table import table_cmd  # noqa: E402
from cz_cli.commands.profile import profile_cmd  # noqa: E402
from cz_cli.commands.workspace import workspace_cmd  # noqa: E402
from cz_cli.commands.skills_installer import main as skills_installer_main  # noqa: E402

cli.add_command(sql_cmd)
cli.add_command(sql_status_cmd)
cli.add_command(schema_cmd)
cli.add_command(table_cmd)
cli.add_command(profile_cmd)
cli.add_command(workspace_cmd)


@cli.command("install-skills")
@click.pass_context
def install_skills_cmd(ctx: click.Context) -> None:
    """Install AI skills for coding assistants (interactive)."""
    skills_installer_main()
