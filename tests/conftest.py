"""Test configuration for cz-cli."""

import os
from pathlib import Path

try:
    import tomllib
except ImportError:
    import tomli as tomllib  # type: ignore

# Test profile path
TEST_PROFILE_DIR = Path.home() / ".clickzetta"
TEST_PROFILE_FILE = TEST_PROFILE_DIR / "profiles.toml"


def get_test_config():
    """Load test configuration from profiles.toml."""
    if not TEST_PROFILE_FILE.exists():
        raise FileNotFoundError(
            f"Test profile not found at {TEST_PROFILE_FILE}. "
            "Please create a profile with: clickzetta profile create test ..."
        )

    with open(TEST_PROFILE_FILE, "rb") as f:
        data = tomllib.load(f)
        profiles = data.get("profiles", {})

        # Try to get 'test' profile, fallback to 'default' or first profile
        if "test" in profiles:
            return profiles["test"]
        elif "default" in profiles:
            return profiles["default"]
        elif profiles:
            return next(iter(profiles.values()))
        else:
            raise ValueError("No profiles found in profiles.toml")


def get_test_jdbc_url():
    """Generate JDBC URL from test configuration."""
    config = get_test_config()
    return (
        f"jdbc:clickzetta://{config['service']}/{config['instance']}"
        f"?username={config['username']}"
        f"&password={config['password']}"
        f"&workspace={config['workspace']}"
        f"&schema={config.get('schema', 'public')}"
        f"&virtualCluster={config.get('vcluster', 'default')}"
    )

