"""clickzetta profile command — manage connection profiles."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import click

from cz_cli import output
from cz_cli.cli_group import CLIGroup
from cz_cli.logger import log_operation

try:
    import tomllib
except ImportError:
    import tomli as tomllib  # type: ignore


_PROFILES_DIR = Path.home() / ".clickzetta"
_PROFILES_FILE = _PROFILES_DIR / "profiles.toml"


def _load_profiles() -> dict[str, Any]:
    """Load profiles from ~/.clickzetta/profiles.toml"""
    if not _PROFILES_FILE.exists():
        return {"profiles": {}}

    try:
        with open(_PROFILES_FILE, "rb") as f:
            return tomllib.load(f)
    except Exception as exc:
        return {"profiles": {}}


def _save_profiles(data: dict[str, Any]) -> None:
    """Save profiles to ~/.clickzetta/profiles.toml"""
    _PROFILES_DIR.mkdir(parents=True, exist_ok=True)

    # Convert to TOML format
    lines = []

    # Add default_profile at the top if it exists
    if "default_profile" in data:
        lines.append(f'default_profile = "{data["default_profile"]}"')
        lines.append("")

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


@click.group("profile", cls=CLIGroup)
@click.pass_context
def profile_cmd(ctx: click.Context) -> None:
    """Manage connection profiles."""


@profile_cmd.command("list")
@click.pass_context
def list_profiles(ctx: click.Context) -> None:
    """List all configured profiles."""
    fmt: str = ctx.obj.get("format", "json")

    try:
        data = _load_profiles()
        profiles = data.get("profiles", {})
        default_profile = data.get("default_profile")

        result = []
        for name, profile_data in profiles.items():
            result.append({
                "name": name,
                "username": profile_data.get("username", ""),
                "service": profile_data.get("service", ""),
                "instance": profile_data.get("instance", ""),
                "workspace": profile_data.get("workspace", ""),
                "is_default": name == default_profile,
            })

        log_operation("profile list", ok=True)
        output.success(result, fmt=fmt)
    except Exception as exc:
        log_operation("profile list", ok=False, error_code="INTERNAL_ERROR")
        output.error("INTERNAL_ERROR", str(exc), fmt=fmt)


@profile_cmd.command("create")
@click.argument("name")
@click.option("--username", required=True, help="Username")
@click.option("--password", required=True, help="Password")
@click.option("--service", default="dev-api.clickzetta.com", help="Service endpoint")
@click.option("--instance", required=True, help="Instance ID")
@click.option("--workspace", required=True, help="Workspace name")
@click.option("--schema", default="public", help="Default schema")
@click.option("--vcluster", default="default", help="Virtual cluster")
@click.option("--skip-verify", is_flag=True, help="Skip connection verification")
@click.pass_context
def create_profile(
    ctx: click.Context,
    name: str,
    username: str,
    password: str,
    service: str,
    instance: str,
    workspace: str,
    schema: str,
    vcluster: str,
    skip_verify: bool,
) -> None:
    """Create a new profile."""
    fmt: str = ctx.obj.get("format", "json")

    try:
        data = _load_profiles()
        profiles = data.get("profiles", {})

        if name in profiles:
            log_operation("profile create", ok=False, error_code="PROFILE_EXISTS")
            output.error("PROFILE_EXISTS", f"Profile '{name}' already exists", fmt=fmt)
            return

        # Verify connection unless --skip-verify
        if not skip_verify:
            from cz_cli.connection import get_connection
            try:
                conn = get_connection(
                    username=username,
                    password=password,
                    service=service,
                    instance=instance,
                    workspace=workspace,
                    schema=schema,
                    vcluster=vcluster,
                )
                # Test connection
                cursor = conn.cursor()
                cursor.execute("SELECT 1")
                cursor.close()
                conn.close()
            except Exception as exc:
                log_operation("profile create", ok=False, error_code="CONNECTION_FAILED")
                output.error(
                    "CONNECTION_FAILED",
                    f"Failed to connect with provided credentials: {str(exc)}",
                    fmt=fmt,
                )
                return

        profiles[name] = {
            "username": username,
            "password": password,
            "service": service,
            "instance": instance,
            "workspace": workspace,
            "schema": schema,
            "vcluster": vcluster,
        }

        data["profiles"] = profiles
        _save_profiles(data)

        log_operation("profile create", ok=True)
        output.success({"message": f"Profile '{name}' created successfully"}, fmt=fmt)
    except Exception as exc:
        log_operation("profile create", ok=False, error_code="INTERNAL_ERROR")
        output.error("INTERNAL_ERROR", str(exc), fmt=fmt)


@profile_cmd.command("update")
@click.argument("name")
@click.argument("key")
@click.argument("value")
@click.pass_context
def update_profile(ctx: click.Context, name: str, key: str, value: str) -> None:
    """Update a profile field."""
    fmt: str = ctx.obj.get("format", "json")

    try:
        data = _load_profiles()
        profiles = data.get("profiles", {})

        if name not in profiles:
            log_operation("profile update", ok=False, error_code="PROFILE_NOT_FOUND")
            output.error("PROFILE_NOT_FOUND", f"Profile '{name}' not found", fmt=fmt)
            return

        valid_keys = ["username", "password", "service", "instance", "workspace", "schema", "vcluster"]
        if key not in valid_keys:
            log_operation("profile update", ok=False, error_code="INVALID_KEY")
            output.error("INVALID_KEY", f"Invalid key '{key}'. Valid keys: {', '.join(valid_keys)}", fmt=fmt)
            return

        profiles[name][key] = value
        data["profiles"] = profiles
        _save_profiles(data)

        log_operation("profile update", ok=True)
        output.success({"message": f"Profile '{name}' updated successfully"}, fmt=fmt)
    except Exception as exc:
        log_operation("profile update", ok=False, error_code="INTERNAL_ERROR")
        output.error("INTERNAL_ERROR", str(exc), fmt=fmt)


@profile_cmd.command("delete")
@click.argument("name")
@click.pass_context
def delete_profile(ctx: click.Context, name: str) -> None:
    """Delete a profile."""
    fmt: str = ctx.obj.get("format", "json")

    try:
        data = _load_profiles()
        profiles = data.get("profiles", {})

        if name not in profiles:
            log_operation("profile delete", ok=False, error_code="PROFILE_NOT_FOUND")
            output.error("PROFILE_NOT_FOUND", f"Profile '{name}' not found", fmt=fmt)
            return

        del profiles[name]
        data["profiles"] = profiles
        _save_profiles(data)

        log_operation("profile delete", ok=True)
        output.success({"message": f"Profile '{name}' deleted successfully"}, fmt=fmt)
    except Exception as exc:
        log_operation("profile delete", ok=False, error_code="INTERNAL_ERROR")
        output.error("INTERNAL_ERROR", str(exc), fmt=fmt)


@profile_cmd.command("use")
@click.argument("name")
@click.pass_context
def use_profile(ctx: click.Context, name: str) -> None:
    """Set a profile as default."""
    fmt: str = ctx.obj.get("format", "json")

    try:
        data = _load_profiles()
        profiles = data.get("profiles", {})

        if name not in profiles:
            log_operation("profile use", ok=False, error_code="PROFILE_NOT_FOUND")
            output.error("PROFILE_NOT_FOUND", f"Profile '{name}' not found", fmt=fmt)
            return

        # Set default_profile marker
        data["default_profile"] = name

        _save_profiles(data)

        log_operation("profile use", ok=True)
        output.success({"message": f"Profile '{name}' set as default"}, fmt=fmt)
    except Exception as exc:
        log_operation("profile use", ok=False, error_code="INTERNAL_ERROR")
        output.error("INTERNAL_ERROR", str(exc), fmt=fmt)
