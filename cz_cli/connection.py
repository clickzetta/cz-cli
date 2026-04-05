"""Connection management for cz-cli.

Supports multiple authentication methods:
  - Profile: ~/.clickzetta/profiles.toml
  - JDBC URL: jdbc:clickzetta://host/warehouse?params
  - Environment variables: CZ_USERNAME, CZ_PASSWORD, etc.
  - Command-line arguments
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

try:
    import tomllib
except ImportError:
    import tomli as tomllib  # type: ignore


@dataclass
class ConnectionConfig:
    """ClickZetta connection configuration."""

    pat: str = ""
    username: str = ""
    password: str = ""
    service: str = "dev-api.clickzetta.com"
    protocol: str = "https"
    instance: str = ""
    workspace: str = ""
    schema: str = "public"
    vcluster: str = "default"


_PROFILES_DIR = Path.home() / ".clickzetta"
_PROFILES_FILE = _PROFILES_DIR / "profiles.toml"


def _normalize_protocol(value: str | None) -> str:
    protocol = (value or "").strip().lower()
    if protocol in {"http", "https"}:
        return protocol
    return "https"


def _parse_jdbc_url(jdbc_url: str) -> ConnectionConfig | None:
    """Parse JDBC URL: jdbc:clickzetta://host/warehouse?params

    Supported format:
        jdbc:clickzetta://<instance>.<service>/<workspace>?username=...&password=...&...
    """
    if not jdbc_url.startswith("jdbc:clickzetta://"):
        return None

    # Remove jdbc: prefix
    url = jdbc_url[5:]  # Remove "jdbc:"

    try:
        parsed = urlparse(url)
        cfg = ConnectionConfig()
        params = parse_qs(parsed.query or "")
        workspace_from_path = (
            parsed.path.lstrip("/") if parsed.path and len(parsed.path) > 1 else ""
        )
        workspace_from_query = (params.get("workspace") or [None])[0]

        if not parsed.hostname:
            return None
        host_parts = parsed.hostname.split(".")
        if len(host_parts) < 4:
            # Require instance-prefixed host: <instance>.<service>
            return None

        cfg.instance = host_parts[0]
        cfg.service = ".".join(host_parts[1:])
        cfg.workspace = workspace_from_path or workspace_from_query or ""

        # Query parameters
        if "username" in params:
            cfg.username = params["username"][0]
        if "password" in params:
            cfg.password = params["password"][0]
        if "schema" in params:
            cfg.schema = params["schema"][0]
        if "virtualCluster" in params:
            cfg.vcluster = params["virtualCluster"][0]
        if "workspace" in params:
            cfg.workspace = params["workspace"][0]
        if "protocol" in params:
            cfg.protocol = _normalize_protocol(params["protocol"][0])

        return cfg
    except Exception:
        return None


def _load_profiles() -> dict[str, dict[str, Any]]:
    """Load profiles from ~/.clickzetta/profiles.toml"""
    if not _PROFILES_FILE.exists():
        return {}

    try:
        with open(_PROFILES_FILE, "rb") as f:
            data = tomllib.load(f)
            return data.get("profiles", {})
    except Exception:
        return {}


def _get_default_profile_name() -> str | None:
    """Get the default profile name from profiles.toml"""
    if not _PROFILES_FILE.exists():
        return None

    try:
        with open(_PROFILES_FILE, "rb") as f:
            data = tomllib.load(f)
            return data.get("default_profile")
    except Exception:
        return None


def _get_profile_config(profile_name: str | None = None) -> ConnectionConfig | None:
    """Get connection config from a profile."""
    profiles = _load_profiles()

    if not profiles:
        return None

    # Use specified profile or default
    if profile_name:
        profile_data = profiles.get(profile_name)
    else:
        # Try to get default_profile marker
        default_name = _get_default_profile_name()
        if default_name:
            profile_data = profiles.get(default_name)
        else:
            # Use first profile if no default
            profile_data = next(iter(profiles.values())) if profiles else None

    if not profile_data:
        return None

    cfg = ConnectionConfig()
    cfg.pat = profile_data.get("pat", "")
    cfg.username = profile_data.get("username", "")
    cfg.password = profile_data.get("password", "")
    cfg.service = profile_data.get("service", "dev-api.clickzetta.com")
    cfg.protocol = _normalize_protocol(profile_data.get("protocol"))
    cfg.instance = profile_data.get("instance", "")
    cfg.workspace = profile_data.get("workspace", "")
    cfg.schema = profile_data.get("schema", "public")
    cfg.vcluster = profile_data.get("vcluster", "default")

    return cfg


def _get_env_config() -> ConnectionConfig | None:
    """Get connection config from environment variables."""
    pat = os.environ.get("CZ_PAT", "")
    username = os.environ.get("CZ_USERNAME")
    password = os.environ.get("CZ_PASSWORD")

    if not pat and (not username or not password):
        return None

    cfg = ConnectionConfig()
    cfg.pat = pat
    cfg.username = username
    cfg.password = password
    cfg.service = os.environ.get("CZ_SERVICE", "dev-api.clickzetta.com")
    cfg.protocol = _normalize_protocol(os.environ.get("CZ_PROTOCOL"))
    cfg.instance = os.environ.get("CZ_INSTANCE", "")
    cfg.workspace = os.environ.get("CZ_WORKSPACE", "")
    cfg.schema = os.environ.get("CZ_SCHEMA", "public")
    cfg.vcluster = os.environ.get("CZ_VCLUSTER", "default")

    return cfg


def resolve_connection_config(
    jdbc_url: str | None = None, profile: str | None = None, **kwargs: Any
) -> ConnectionConfig:
    """Resolve connection configuration from multiple sources.

    Priority order:
      1. Command-line arguments (kwargs)
      2. JDBC URL
      3. Environment variables
      4. Profile configuration
      5. Defaults
    """
    profile_cfg = _get_profile_config(profile)
    if not profile_cfg and not profile:
        profile_cfg = _get_profile_config()
    env_cfg = _get_env_config()
    if jdbc_url:
        jdbc_cfg = _parse_jdbc_url(jdbc_url)
    else:
        jdbc_cfg = None

    cfg = ConnectionConfig()

    def _apply_non_auth(src: ConnectionConfig | None) -> None:
        if not src:
            return
        if src.service:
            cfg.service = src.service
        if src.protocol:
            cfg.protocol = _normalize_protocol(src.protocol)
        if src.instance:
            cfg.instance = src.instance
        if src.workspace:
            cfg.workspace = src.workspace
        if src.schema:
            cfg.schema = src.schema
        if src.vcluster:
            cfg.vcluster = src.vcluster

    _apply_non_auth(profile_cfg)
    _apply_non_auth(env_cfg)
    _apply_non_auth(jdbc_cfg)

    # Override with command-line arguments
    for key, value in kwargs.items():
        if value is not None and key in (
            "service",
            "protocol",
            "instance",
            "workspace",
            "schema",
            "vcluster",
        ):
            setattr(cfg, key, value)
    cfg.protocol = _normalize_protocol(cfg.protocol)

    # Authentication priority:
    # --pat > CZ_PAT > profile pat > --username/--password > JDBC user/pass > env user/pass > profile user/pass
    cli_pat = kwargs.get("pat") or ""
    env_pat = os.environ.get("CZ_PAT", "")
    profile_pat = (profile_cfg.pat if profile_cfg else "") or ""

    cli_username = kwargs.get("username")
    cli_password = kwargs.get("password")
    jdbc_username = jdbc_cfg.username if jdbc_cfg else ""
    jdbc_password = jdbc_cfg.password if jdbc_cfg else ""
    env_username = env_cfg.username if env_cfg else ""
    env_password = env_cfg.password if env_cfg else ""
    profile_username = profile_cfg.username if profile_cfg else ""
    profile_password = profile_cfg.password if profile_cfg else ""

    if cli_pat:
        cfg.pat = cli_pat
    elif env_pat:
        cfg.pat = env_pat
    elif profile_pat:
        cfg.pat = profile_pat
    elif cli_username is not None or cli_password is not None:
        merged_username = cli_username or jdbc_username or env_username or profile_username
        merged_password = cli_password or jdbc_password or env_password or profile_password
        if merged_username and merged_password:
            cfg.username = merged_username
            cfg.password = merged_password
    elif jdbc_username and jdbc_password:
        cfg.username = jdbc_username
        cfg.password = jdbc_password
    elif env_username and env_password:
        cfg.username = env_username
        cfg.password = env_password
    elif profile_username and profile_password:
        cfg.username = profile_username
        cfg.password = profile_password

    if cfg.pat:
        cfg.username = ""
        cfg.password = ""

    return cfg


def get_connection(jdbc_url: str | None = None, profile: str | None = None, **kwargs: Any) -> Any:
    """Get a ClickZetta connection.

    Returns a clickzetta.connector.v0.connection.Connection object.
    """
    from clickzetta.connector.v0.connection import connect

    cfg = resolve_connection_config(jdbc_url, profile, **kwargs)

    # Validate required fields
    if not cfg.pat and not (cfg.username and cfg.password):
        raise ValueError("Authentication required: set pat or username/password in your profile")
    if not cfg.instance:
        raise ValueError(
            "Instance is required. Set via profile, environment variable, or --instance"
        )
    if not cfg.workspace:
        raise ValueError(
            "Workspace is required. Set via profile, environment variable, or --workspace"
        )

    connect_kwargs = {
        "service": cfg.service,
        "instance": cfg.instance,
        "workspace": cfg.workspace,
        "schema": cfg.schema,
        "vcluster": cfg.vcluster,
    }

    if cfg.pat:
        from cz_mcp.handlers.login_server import login_wrapper

        base_url = (
            cfg.service if cfg.service.startswith("http") else f"{cfg.protocol}://{cfg.service}"
        )
        login_data = login_wrapper(instance=cfg.instance, pat=cfg.pat, url=base_url)
        token = login_data.get("token")
        if not token:
            raise ValueError("PAT authentication failed: token not found in login response")
        connect_kwargs["magic_token"] = token
    else:
        connect_kwargs["username"] = cfg.username
        connect_kwargs["password"] = cfg.password

    # Connect using clickzetta-connector
    return connect(**connect_kwargs)
