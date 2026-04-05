"""cz-cli — AI-Agent-friendly CLI for ClickZetta Lakehouse."""

from __future__ import annotations

import json

import click

from cz_cli import output
from cz_cli.cli_group import CLIGroup
from cz_cli.connection_ctx import connection_kwargs_from_ctx
from cz_cli.connection import get_connection
from cz_cli.version import __version__
from cz_cli.guide_builder import build_ai_guide
from cz_cli.logger import log_operation


@click.group(invoke_without_command=True, cls=CLIGroup)
@click.option("--profile", "-p", help="Profile name from ~/.clickzetta/profiles.toml")
@click.option("--jdbc", "jdbc_url", help="JDBC connection URL (jdbc:clickzetta://...)")
@click.option("--pat", help="Personal Access Token (PAT)")
@click.option("--username", help="Username")
@click.option("--password", help="Password")
@click.option("--service", help="Service endpoint (e.g., dev-api.clickzetta.com)")
@click.option(
    "--protocol",
    type=click.Choice(["https", "http"], case_sensitive=False),
    help="Service protocol override.",
)
@click.option("--instance", help="Instance ID")
@click.option("--workspace", help="Workspace name")
@click.option("--schema", "-s", help="Default schema")
@click.option("--vcluster", "-v", help="Virtual cluster")
@click.option(
    "--output",
    "-o",
    "fmt",
    type=click.Choice(["json", "pretty", "table", "csv", "jsonl", "toon"]),
    default="json",
    help="Output format",
)
@click.option("--debug", "-d", is_flag=True, help="Enable debug mode")
@click.option("--silent", is_flag=True, help="Suppress non-essential output")
@click.option("--verbose", is_flag=True, help="Verbose output")
@click.version_option(__version__, message="version %(version)s")
@click.pass_context
def cli(
    ctx: click.Context,
    profile: str | None,
    jdbc_url: str | None,
    pat: str | None,
    username: str | None,
    password: str | None,
    service: str | None,
    protocol: str | None,
    instance: str | None,
    workspace: str | None,
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
    ctx.obj["pat"] = pat
    ctx.obj["username"] = username
    ctx.obj["password"] = password
    ctx.obj["service"] = service
    ctx.obj["protocol"] = protocol.lower() if protocol else None
    ctx.obj["instance"] = instance
    ctx.obj["workspace"] = workspace
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
        conn = get_connection(jdbc_url=jdbc_url, profile=profile, **connection_kwargs_from_ctx(ctx))
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


@cli.command("ai-guide")
@click.option(
    "--wide",
    is_flag=True,
    help="Include per-command options and arguments in the ai-guide output.",
)
@click.pass_context
def ai_guide_cmd(ctx: click.Context, wide: bool) -> None:
    """Output structured AI Agent usage guide (JSON)."""
    log_operation("ai-guide", ok=True)
    payload = build_ai_guide(cli, cli_version=__version__, wide=wide)
    click.echo(json.dumps(payload, ensure_ascii=False, indent=2))
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
from cz_cli.commands.task import task_cmd  # noqa: E402
from cz_cli.commands.runs import runs_cmd  # noqa: E402
from cz_cli.commands.executions import executions_cmd  # noqa: E402

cli.add_command(sql_cmd)
cli.add_command(sql_status_cmd)
cli.add_command(schema_cmd)
cli.add_command(table_cmd)
cli.add_command(profile_cmd)
cli.add_command(workspace_cmd)
cli.add_command(task_cmd)
cli.add_command(runs_cmd)
cli.add_command(executions_cmd)


@cli.command("install-skills")
@click.pass_context
def install_skills_cmd(ctx: click.Context) -> None:
    """Install AI skills for coding assistants (interactive)."""
    skills_installer_main()
