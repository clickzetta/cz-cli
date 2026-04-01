"""Connection management for cz-cli.

Supports multiple authentication methods:
  - Profile: ~/.clickzetta/profiles.toml
  - JDBC URL: jdbc:clickzetta://host/warehouse?params
  - Environment variables: CZ_USERNAME, CZ_PASSWORD, etc.
  - Command-line arguments
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

try:
    import tomllib
except ImportError:
    import tomli as tomllib  # type: ignore


@dataclass
class ConnectionConfig:
    """ClickZetta connection configuration."""
    username: str = ""
    password: str = ""
    service: str = "dev-api.clickzetta.com"
    instance: str = ""
    workspace: str = ""
    schema: str = "public"
    vcluster: str = "default"


_PROFILES_DIR = Path.home() / ".clickzetta"
_PROFILES_FILE = _PROFILES_DIR / "profiles.toml"


def _parse_jdbc_url(jdbc_url: str) -> ConnectionConfig | None:
    """Parse JDBC URL: jdbc:clickzetta://host/warehouse?params

    Example:
        jdbc:clickzetta://clickzetta.dev-api.clickzetta.com/system_meta_warehouse?
        schema=meta_warehouse&username=user&password=pass&virtualCluster=CZ_GP_DEFAULT
    """
    if not jdbc_url.startswith("jdbc:clickzetta://"):
        return None

    # Remove jdbc: prefix
    url = jdbc_url[5:]  # Remove "jdbc:"

    try:
        parsed = urlparse(url)
        cfg = ConnectionConfig()

        # Host is service
        if parsed.hostname:
            cfg.service = parsed.hostname

        # Path is instance/warehouse
        if parsed.path and len(parsed.path) > 1:
            cfg.instance = parsed.path.lstrip("/")

        # Query parameters
        if parsed.query:
            params = parse_qs(parsed.query)
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
    cfg.username = profile_data.get("username", "")
    cfg.password = profile_data.get("password", "")
    cfg.service = profile_data.get("service", "dev-api.clickzetta.com")
    cfg.instance = profile_data.get("instance", "")
    cfg.workspace = profile_data.get("workspace", "")
    cfg.schema = profile_data.get("schema", "public")
    cfg.vcluster = profile_data.get("vcluster", "default")

    return cfg


def _get_env_config() -> ConnectionConfig | None:
    """Get connection config from environment variables."""
    username = os.environ.get("CZ_USERNAME")
    password = os.environ.get("CZ_PASSWORD")

    if not username or not password:
        return None

    cfg = ConnectionConfig()
    cfg.username = username
    cfg.password = password
    cfg.service = os.environ.get("CZ_SERVICE", "dev-api.clickzetta.com")
    cfg.instance = os.environ.get("CZ_INSTANCE", "")
    cfg.workspace = os.environ.get("CZ_WORKSPACE", "")
    cfg.schema = os.environ.get("CZ_SCHEMA", "public")
    cfg.vcluster = os.environ.get("CZ_VCLUSTER", "default")

    return cfg


def resolve_connection_config(
    jdbc_url: str | None = None,
    profile: str | None = None,
    **kwargs: Any
) -> ConnectionConfig:
    """Resolve connection configuration from multiple sources.

    Priority order:
      1. Command-line arguments (kwargs)
      2. JDBC URL
      3. Environment variables
      4. Profile configuration
      5. Defaults
    """
    cfg = ConnectionConfig()

    # Start with profile if specified
    if profile:
        profile_cfg = _get_profile_config(profile)
        if profile_cfg:
            cfg = profile_cfg
    else:
        # Try environment variables
        env_cfg = _get_env_config()
        if env_cfg:
            cfg = env_cfg
        else:
            # Try default profile
            profile_cfg = _get_profile_config()
            if profile_cfg:
                cfg = profile_cfg

    # Override with JDBC URL if provided
    if jdbc_url:
        jdbc_cfg = _parse_jdbc_url(jdbc_url)
        if jdbc_cfg:
            if jdbc_cfg.username:
                cfg.username = jdbc_cfg.username
            if jdbc_cfg.password:
                cfg.password = jdbc_cfg.password
            if jdbc_cfg.service:
                cfg.service = jdbc_cfg.service
            if jdbc_cfg.instance:
                cfg.instance = jdbc_cfg.instance
            if jdbc_cfg.workspace:
                cfg.workspace = jdbc_cfg.workspace
            if jdbc_cfg.schema:
                cfg.schema = jdbc_cfg.schema
            if jdbc_cfg.vcluster:
                cfg.vcluster = jdbc_cfg.vcluster

    # Override with command-line arguments
    for key, value in kwargs.items():
        if value is not None and hasattr(cfg, key):
            setattr(cfg, key, value)

    return cfg


def get_connection(
    jdbc_url: str | None = None,
    profile: str | None = None,
    **kwargs: Any
) -> Any:
    """Get a ClickZetta connection.

    Returns a clickzetta.connector.v0.connection.Connection object.
    """
    from clickzetta.connector.v0.connection import connect

    cfg = resolve_connection_config(jdbc_url, profile, **kwargs)

    # Validate required fields
    if not cfg.username:
        raise ValueError("Username is required. Set via profile, environment variable, or --username")
    if not cfg.password:
        raise ValueError("Password is required. Set via profile, environment variable, or --password")
    if not cfg.instance:
        raise ValueError("Instance is required. Set via profile, environment variable, or --instance")
    if not cfg.workspace:
        raise ValueError("Workspace is required. Set via profile, environment variable, or --workspace")

    # Connect using clickzetta-connector
    return connect(
        username=cfg.username,
        password=cfg.password,
        service=cfg.service,
        instance=cfg.instance,
        workspace=cfg.workspace,
        schema=cfg.schema,
        vcluster=cfg.vcluster,
    )
