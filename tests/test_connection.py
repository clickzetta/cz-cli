"""Unit tests for connection.py"""

import pytest
from cz_cli.connection import (
    ConnectionConfig,
    _parse_jdbc_url,
    resolve_connection_config,
)


def test_connection_config_defaults():
    """Test ConnectionConfig default values."""
    cfg = ConnectionConfig()
    assert cfg.username == ""
    assert cfg.password == ""
    assert cfg.service == "dev-api.clickzetta.com"
    assert cfg.schema == "public"
    assert cfg.vcluster == "default"


def test_parse_jdbc_url_basic():
    """Test basic JDBC URL parsing."""
    url = "jdbc:clickzetta://dev-api.clickzetta.com/myinstance?username=user&password=pass&workspace=ws"
    cfg = _parse_jdbc_url(url)

    assert cfg is not None
    assert cfg.service == "dev-api.clickzetta.com"
    assert cfg.instance == "myinstance"
    assert cfg.username == "user"
    assert cfg.password == "pass"
    assert cfg.workspace == "ws"


def test_parse_jdbc_url_with_schema():
    """Test JDBC URL parsing with schema."""
    url = "jdbc:clickzetta://host/inst?username=u&password=p&workspace=w&schema=myschema"
    cfg = _parse_jdbc_url(url)

    assert cfg is not None
    assert cfg.schema == "myschema"


def test_parse_jdbc_url_with_vcluster():
    """Test JDBC URL parsing with virtualCluster."""
    url = "jdbc:clickzetta://host/inst?username=u&password=p&workspace=w&virtualCluster=vc1"
    cfg = _parse_jdbc_url(url)

    assert cfg is not None
    assert cfg.vcluster == "vc1"


def test_parse_jdbc_url_invalid():
    """Test invalid JDBC URL."""
    cfg = _parse_jdbc_url("not-a-jdbc-url")
    assert cfg is None

    cfg = _parse_jdbc_url("jdbc:mysql://host/db")
    assert cfg is None


def test_resolve_connection_config_kwargs_override():
    """Test that kwargs override other sources."""
    cfg = resolve_connection_config(
        username="user1",
        password="pass1",
        instance="inst1",
        workspace="ws1",
    )

    assert cfg.username == "user1"
    assert cfg.password == "pass1"
    assert cfg.instance == "inst1"
    assert cfg.workspace == "ws1"


def test_resolve_connection_config_jdbc_url():
    """Test JDBC URL resolution."""
    jdbc_url = "jdbc:clickzetta://host/inst?username=user&password=pass&workspace=ws"
    cfg = resolve_connection_config(jdbc_url=jdbc_url)

    assert cfg.username == "user"
    assert cfg.password == "pass"
    assert cfg.instance == "inst"
    assert cfg.workspace == "ws"


def test_resolve_connection_config_jdbc_url_with_override():
    """Test JDBC URL with kwargs override."""
    jdbc_url = "jdbc:clickzetta://host/inst?username=user&password=pass&workspace=ws"
    cfg = resolve_connection_config(jdbc_url=jdbc_url, username="override_user")

    assert cfg.username == "override_user"  # kwargs override
    assert cfg.password == "pass"  # from JDBC URL
