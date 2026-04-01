"""clickzetta workspace command — manage workspaces."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import click

from cz_cli import output
from cz_cli.connection import get_connection
from cz_cli.logger import log_operation

try:
    import tomllib
except ImportError:
    import tomli as tomllib  # type: ignore


_PROFILES_DIR = Path.home() / ".clickzetta"
_PROFILES_FILE = _PROFILES_DIR / "profiles.toml"


@click.group("workspace")
@click.pass_context
def workspace_cmd(ctx: click.Context) -> None:
    """Manage workspaces."""


@workspace_cmd.command("current")
@click.pass_context
def current_workspace(ctx: click.Context) -> None:
    """Show current workspace."""
    fmt: str = ctx.obj["format"]
    profile: str | None = ctx.obj.get("profile")

    try:
        conn = get_connection(profile=profile)
    except Exception as exc:
        log_operation("workspace current", ok=False, error_code="CONNECTION_ERROR")
        output.error("CONNECTION_ERROR", str(exc), fmt=fmt)
        return

    timer = output.Timer()
    try:
        with timer:
            cursor = conn.cursor()
            try:
                cursor.execute("SELECT current_workspace()")
                rows = cursor.fetchall()

                if rows:
                    workspace_name = list(rows[0].values())[0]
                    log_operation("workspace current", ok=True, time_ms=timer.elapsed_ms)
                    output.success({"workspace": workspace_name}, time_ms=timer.elapsed_ms, fmt=fmt)
                else:
                    log_operation("workspace current", ok=False, error_code="NO_RESULT")
                    output.error("NO_RESULT", "No workspace found", fmt=fmt)
            finally:
                cursor.close()
    except Exception as exc:
        log_operation("workspace current", ok=False, error_code="SQL_ERROR")
        output.error("SQL_ERROR", str(exc), fmt=fmt)
    finally:
        conn.close()


@workspace_cmd.command("use")
@click.argument("name")
@click.option("--schema", default=None, help="Schema to use (defaults to current profile schema)")
@click.option("--persist", is_flag=True, help="Update profile configuration to persist the change")
@click.pass_context
def use_workspace(ctx: click.Context, name: str, schema: str | None, persist: bool) -> None:
    """Switch to a workspace using SDK hints.

    This command uses the SDK hint 'sdk.job.default.ns' to switch workspace context.
    Use --persist to also update the current profile configuration.
    """
    fmt: str = ctx.obj["format"]
    profile: str | None = ctx.obj.get("profile")

    # If persist is requested, update the profile
    if persist:
        try:
            data = _load_profiles()
            profiles = data.get("profiles", {})

            # Determine which profile to update
            profile_name = profile or "default"
            if profile_name not in profiles:
                log_operation("workspace use", ok=False, error_code="PROFILE_NOT_FOUND")
                output.error("PROFILE_NOT_FOUND", f"Profile '{profile_name}' not found", fmt=fmt)
                return

            profiles[profile_name]["workspace"] = name
            if schema:
                profiles[profile_name]["schema"] = schema

            data["profiles"] = profiles
            _save_profiles(data)

            log_operation("workspace use", ok=True)
            output.success({
                "message": f"Switched to workspace '{name}' and updated profile '{profile_name}'",
                "workspace": name,
                "schema": schema or profiles[profile_name].get("schema", "public")
            }, fmt=fmt)
        except Exception as exc:
            log_operation("workspace use", ok=False, error_code="PROFILE_UPDATE_ERROR")
            output.error("PROFILE_UPDATE_ERROR", str(exc), fmt=fmt)
    else:
        # Just show the hint that would be used
        # Note: The actual SDK hint application happens at connection/query time
        # This command primarily serves to update the profile for persistence
        schema_name = schema or "public"
        log_operation("workspace use", ok=True)
        output.success({
            "message": f"To use workspace '{name}', set SDK hint: {{'sdk.job.default.ns': '{name}.{schema_name}'}}",
            "workspace": name,
            "schema": schema_name,
            "note": "Use --persist to save this to your profile configuration"
        }, fmt=fmt)


def _load_profiles() -> dict[str, Any]:
    """Load profiles from ~/.clickzetta/profiles.toml"""
    if not _PROFILES_FILE.exists():
        return {"profiles": {}}

    try:
        with open(_PROFILES_FILE, "rb") as f:
            return tomllib.load(f)
    except Exception:
        return {"profiles": {}}


def _save_profiles(data: dict[str, Any]) -> None:
    """Save profiles to ~/.clickzetta/profiles.toml"""
    _PROFILES_DIR.mkdir(parents=True, exist_ok=True)

    # Convert to TOML format
    lines = []
    for profile_name, profile_data in data.get("profiles", {}).items():
        lines.append(f"[profiles.{profile_name}]")
        for key, value in profile_data.items():
            if isinstance(value, str):
                lines.append(f'{key} = "{value}"')
            else:
                lines.append(f"{key} = {value}")
        lines.append("")

    with open(_PROFILES_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
