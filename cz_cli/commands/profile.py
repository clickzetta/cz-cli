"""clickzetta profile command — manage connection profiles."""

from __future__ import annotations

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
    except Exception:
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
            pat = profile_data.get("pat", "")
            auth_mode = "pat" if pat else "password"
            result.append(
                {
                    "name": name,
                    "auth_mode": auth_mode,
                    "pat": f"{pat[:8]}****" if pat else "",
                    "username": profile_data.get("username", "") if not pat else "",
                    "service": profile_data.get("service", ""),
                    "protocol": profile_data.get("protocol", "https"),
                    "instance": profile_data.get("instance", ""),
                    "workspace": profile_data.get("workspace", ""),
                    "is_default": name == default_profile,
                }
            )

        log_operation("profile list", ok=True)
        output.success(result, fmt=fmt)
    except Exception as exc:
        log_operation("profile list", ok=False, error_code="INTERNAL_ERROR")
        output.error("INTERNAL_ERROR", str(exc), fmt=fmt)


@profile_cmd.command("show")
@click.argument("name")
@click.option("--mask", is_flag=True, help="Mask sensitive fields (pat/password) in output.")
@click.pass_context
def show_profile(ctx: click.Context, name: str, mask: bool) -> None:
    """Show full configuration for a profile by name."""
    fmt: str = ctx.obj.get("format", "json")

    try:
        data = _load_profiles()
        profiles = data.get("profiles", {})
        default_profile = data.get("default_profile")
        profile = profiles.get(name)
        if profile is None:
            log_operation("profile show", ok=False, error_code="PROFILE_NOT_FOUND")
            output.error("PROFILE_NOT_FOUND", f"Profile '{name}' not found", fmt=fmt)
            return

        result = {"name": name, "is_default": name == default_profile, **dict(profile)}
        if mask:
            if result.get("pat"):
                pat = str(result["pat"])
                result["pat"] = f"{pat[:8]}****" if len(pat) > 8 else "****"
            if result.get("password"):
                result["password"] = "******"

        log_operation("profile show", ok=True)
        output.success(result, fmt=fmt)
    except Exception as exc:
        log_operation("profile show", ok=False, error_code="INTERNAL_ERROR")
        output.error("INTERNAL_ERROR", str(exc), fmt=fmt)


@profile_cmd.command("create")
@click.argument("name")
@click.option("--jdbc", "jdbc_url", help="JDBC connection URL (jdbc:clickzetta://...).")
@click.option("--username", help="Username")
@click.option("--password", help="Password")
@click.option("--pat", help="Personal Access Token (PAT)")
@click.option("--service", help="Service endpoint")
@click.option(
    "--protocol",
    type=click.Choice(["https", "http"], case_sensitive=False),
    help="Service protocol override.",
)
@click.option("--instance", help="Instance ID")
@click.option("--workspace", help="Workspace name")
@click.option("--schema", help="Default schema")
@click.option("--vcluster", help="Virtual cluster")
@click.option("--skip-verify", is_flag=True, help="Skip connection verification")
@click.pass_context
def create_profile(
    ctx: click.Context,
    name: str,
    jdbc_url: str | None,
    username: str | None,
    password: str | None,
    pat: str | None,
    service: str | None,
    protocol: str | None,
    instance: str | None,
    workspace: str | None,
    schema: str | None,
    vcluster: str | None,
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

        jdbc_cfg = None
        if jdbc_url:
            from cz_cli.connection import _parse_jdbc_url

            jdbc_cfg = _parse_jdbc_url(jdbc_url)
            if jdbc_cfg is None:
                log_operation("profile create", ok=False, error_code="INVALID_ARGUMENTS")
                output.error(
                    "INVALID_ARGUMENTS",
                    "Invalid --jdbc. Expected format: jdbc:clickzetta://<instance>.<service>/<workspace>?username=<u>&password=<p>",
                    fmt=fmt,
                    exit_code=output.EXIT_USAGE_ERROR,
                )
                return

        resolved_service = service or (jdbc_cfg.service if jdbc_cfg else "dev-api.clickzetta.com")
        resolved_protocol = (
            protocol.lower() if protocol else (jdbc_cfg.protocol if jdbc_cfg else "https")
        ) or "https"
        resolved_instance = instance or (jdbc_cfg.instance if jdbc_cfg else "")
        resolved_workspace = workspace or (jdbc_cfg.workspace if jdbc_cfg else "")
        resolved_schema = schema or (jdbc_cfg.schema if jdbc_cfg else "public")
        resolved_vcluster = vcluster or (jdbc_cfg.vcluster if jdbc_cfg else "default")

        resolved_username = username or (jdbc_cfg.username if jdbc_cfg else None)
        resolved_password = password or (jdbc_cfg.password if jdbc_cfg else None)

        has_pat = bool(pat)
        has_user_pwd = bool(resolved_username and resolved_password)
        if has_pat and (resolved_username or resolved_password):
            log_operation("profile create", ok=False, error_code="INVALID_ARGUMENTS")
            output.error(
                "INVALID_ARGUMENTS",
                "Cannot specify both --pat and --username/--password. Choose one authentication method.",
                fmt=fmt,
                exit_code=output.EXIT_USAGE_ERROR,
            )
            return
        if not has_pat and not has_user_pwd:
            log_operation("profile create", ok=False, error_code="INVALID_ARGUMENTS")
            output.error(
                "INVALID_ARGUMENTS",
                "Authentication required: provide either --pat or both --username and --password (can come from --jdbc query parameters).",
                fmt=fmt,
                exit_code=output.EXIT_USAGE_ERROR,
            )
            return
        if not resolved_instance or not resolved_workspace:
            log_operation("profile create", ok=False, error_code="INVALID_ARGUMENTS")
            output.error(
                "INVALID_ARGUMENTS",
                "Both instance and workspace are required (provide via --instance/--workspace or --jdbc).",
                fmt=fmt,
                exit_code=output.EXIT_USAGE_ERROR,
            )
            return

        # Verify connection unless --skip-verify
        if not skip_verify:
            from cz_cli.connection import get_connection

            try:
                kwargs = {
                    "service": resolved_service,
                    "instance": resolved_instance,
                    "workspace": resolved_workspace,
                    "schema": resolved_schema,
                    "vcluster": resolved_vcluster,
                }
                if resolved_protocol:
                    kwargs["protocol"] = resolved_protocol
                if has_pat:
                    kwargs["pat"] = pat
                else:
                    kwargs["username"] = resolved_username
                    kwargs["password"] = resolved_password
                conn = get_connection(**kwargs)
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

        profile_obj = {
            "service": resolved_service,
            "instance": resolved_instance,
            "workspace": resolved_workspace,
            "schema": resolved_schema,
            "vcluster": resolved_vcluster,
        }
        if resolved_protocol:
            profile_obj["protocol"] = resolved_protocol
        if has_pat:
            profile_obj["pat"] = pat
        else:
            profile_obj["username"] = resolved_username
            profile_obj["password"] = resolved_password
        profiles[name] = profile_obj

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

        valid_keys = [
            "pat",
            "username",
            "password",
            "service",
            "protocol",
            "instance",
            "workspace",
            "schema",
            "vcluster",
        ]
        if key not in valid_keys:
            log_operation("profile update", ok=False, error_code="INVALID_KEY")
            output.error(
                "INVALID_KEY", f"Invalid key '{key}'. Valid keys: {', '.join(valid_keys)}", fmt=fmt
            )
            return
        if key == "protocol":
            normalized = value.lower()
            if normalized not in {"http", "https"}:
                log_operation("profile update", ok=False, error_code="INVALID_ARGUMENTS")
                output.error("INVALID_ARGUMENTS", "protocol must be one of: http, https", fmt=fmt)
                return
            value = normalized

        profiles[name][key] = value
        if key == "pat":
            profiles[name].pop("username", None)
            profiles[name].pop("password", None)
        if key in ("username", "password"):
            profiles[name].pop("pat", None)
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
