"""Unit tests for connection.py"""

from cz_cli.connection import (
    ConnectionConfig,
    _parse_jdbc_url,
    get_connection,
    resolve_connection_config,
)


def test_connection_config_defaults():
    """Test ConnectionConfig default values."""
    cfg = ConnectionConfig()
    assert cfg.username == ""
    assert cfg.password == ""
    assert cfg.service == "dev-api.clickzetta.com"
    assert cfg.protocol == "https"
    assert cfg.schema == "public"
    assert cfg.vcluster == "default"


def test_parse_jdbc_url_basic():
    """Test basic JDBC URL parsing."""
    url = "jdbc:clickzetta://tmwmzxzs.dev-api.clickzetta.com/wanxin_test_08?username=user&password=pass"
    cfg = _parse_jdbc_url(url)

    assert cfg is not None
    assert cfg.service == "dev-api.clickzetta.com"
    assert cfg.instance == "tmwmzxzs"
    assert cfg.username == "user"
    assert cfg.password == "pass"
    assert cfg.workspace == "wanxin_test_08"


def test_parse_jdbc_url_with_schema():
    """Test JDBC URL parsing with schema."""
    url = "jdbc:clickzetta://inst.dev-api.clickzetta.com/w?username=u&password=p&schema=myschema"
    cfg = _parse_jdbc_url(url)

    assert cfg is not None
    assert cfg.schema == "myschema"


def test_parse_jdbc_url_with_protocol():
    """Test JDBC URL parsing with protocol parameter."""
    url = "jdbc:clickzetta://inst.dev-api.clickzetta.com/w?username=u&password=p&protocol=http"
    cfg = _parse_jdbc_url(url)

    assert cfg is not None
    assert cfg.protocol == "http"


def test_parse_jdbc_url_with_vcluster():
    """Test JDBC URL parsing with virtualCluster."""
    url = "jdbc:clickzetta://inst.dev-api.clickzetta.com/w?username=u&password=p&virtualCluster=vc1"
    cfg = _parse_jdbc_url(url)

    assert cfg is not None
    assert cfg.vcluster == "vc1"


def test_parse_jdbc_url_instance_prefixed_host_workspace_path():
    """Support jdbc:clickzetta://<instance>.<service>/<workspace>?... format."""
    url = "jdbc:clickzetta://tmwmzxzs.dev-api.clickzetta.com/wanxin_test_08?username=u&password=p&schema=public&virtualCluster=default"
    cfg = _parse_jdbc_url(url)

    assert cfg is not None
    assert cfg.instance == "tmwmzxzs"
    assert cfg.service == "dev-api.clickzetta.com"
    assert cfg.workspace == "wanxin_test_08"
    assert cfg.username == "u"
    assert cfg.password == "p"


def test_parse_jdbc_url_invalid():
    """Test invalid JDBC URL."""
    cfg = _parse_jdbc_url("not-a-jdbc-url")
    assert cfg is None

    cfg = _parse_jdbc_url("jdbc:mysql://host/db")
    assert cfg is None

    # Old canonical format is no longer supported
    cfg = _parse_jdbc_url(
        "jdbc:clickzetta://dev-api.clickzetta.com/inst?workspace=ws&username=u&password=p"
    )
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
    jdbc_url = "jdbc:clickzetta://inst.dev-api.clickzetta.com/ws?username=user&password=pass"
    cfg = resolve_connection_config(jdbc_url=jdbc_url)

    assert cfg.username == "user"
    assert cfg.password == "pass"
    assert cfg.instance == "inst"
    assert cfg.workspace == "ws"
    assert cfg.protocol == "https"


def test_resolve_connection_config_jdbc_url_with_override():
    """Test JDBC URL with kwargs override."""
    jdbc_url = "jdbc:clickzetta://inst.dev-api.clickzetta.com/ws?username=user&password=pass"
    cfg = resolve_connection_config(jdbc_url=jdbc_url, username="override_user")

    assert cfg.username == "override_user"  # kwargs override
    assert cfg.password == "pass"  # from JDBC URL


def test_resolve_connection_config_jdbc_url_instance_prefixed_format():
    """Resolve connection config from instance-prefixed host + workspace-path JDBC format."""
    jdbc_url = "jdbc:clickzetta://tmwmzxzs.dev-api.clickzetta.com/wanxin_test_08?username=user&password=pass"
    cfg = resolve_connection_config(jdbc_url=jdbc_url)

    assert cfg.service == "dev-api.clickzetta.com"
    assert cfg.instance == "tmwmzxzs"
    assert cfg.workspace == "wanxin_test_08"
    assert cfg.username == "user"
    assert cfg.password == "pass"


def test_resolve_connection_config_pat_priority(monkeypatch):
    """PAT should win over username/password sources."""
    profile_cfg = ConnectionConfig(
        pat="profile_pat",
        username="profile_user",
        password="profile_pass",
        service="svc",
        instance="inst",
        workspace="ws",
    )
    env_cfg = ConnectionConfig(
        pat="env_pat",
        username="env_user",
        password="env_pass",
        service="svc",
        instance="inst",
        workspace="ws",
    )
    monkeypatch.setattr(
        "cz_cli.connection._get_profile_config", lambda profile_name=None: profile_cfg
    )
    monkeypatch.setattr("cz_cli.connection._get_env_config", lambda: env_cfg)
    monkeypatch.setenv("CZ_PAT", "env_pat")

    cfg = resolve_connection_config(username="cli_user", password="cli_pass")
    assert cfg.pat == "env_pat"
    assert cfg.username == ""
    assert cfg.password == ""


def test_resolve_connection_config_cli_pat_wins(monkeypatch):
    """CLI --pat should win over env/profile PAT."""
    profile_cfg = ConnectionConfig(
        pat="profile_pat", service="svc", instance="inst", workspace="ws"
    )
    env_cfg = ConnectionConfig(pat="env_pat", service="svc", instance="inst", workspace="ws")
    monkeypatch.setattr(
        "cz_cli.connection._get_profile_config", lambda profile_name=None: profile_cfg
    )
    monkeypatch.setattr("cz_cli.connection._get_env_config", lambda: env_cfg)
    monkeypatch.setenv("CZ_PAT", "env_pat")

    cfg = resolve_connection_config(pat="cli_pat")
    assert cfg.pat == "cli_pat"


def test_get_connection_pat_uses_magic_token(monkeypatch):
    """PAT auth should exchange PAT to JWT and call connector with magic_token."""
    captured: dict[str, str] = {}

    def _fake_login_wrapper(instance, pat=None, username=None, password=None, url=None):
        assert instance == "inst"
        assert pat == "pat_token"
        assert url == "https://dev-api.clickzetta.com"
        return {"token": "jwt_token"}

    def _fake_connect(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr("cz_mcp.handlers.login_server.login_wrapper", _fake_login_wrapper)
    monkeypatch.setattr("clickzetta.connector.v0.connection.connect", _fake_connect)

    get_connection(
        pat="pat_token",
        service="dev-api.clickzetta.com",
        instance="inst",
        workspace="ws",
        schema="public",
        vcluster="default",
    )
    assert captured["magic_token"] == "jwt_token"
    assert "username" not in captured
    assert "password" not in captured


def test_get_connection_pat_supports_http_protocol(monkeypatch):
    """PAT auth should honor protocol=http when service has no scheme."""

    def _fake_login_wrapper(instance, pat=None, username=None, password=None, url=None):
        assert instance == "inst"
        assert pat == "pat_token"
        assert url == "http://dev-api.clickzetta.com"
        return {"token": "jwt_token"}

    def _fake_connect(**kwargs):
        return kwargs

    monkeypatch.setattr("cz_mcp.handlers.login_server.login_wrapper", _fake_login_wrapper)
    monkeypatch.setattr("clickzetta.connector.v0.connection.connect", _fake_connect)

    get_connection(
        pat="pat_token",
        service="dev-api.clickzetta.com",
        protocol="http",
        instance="inst",
        workspace="ws",
        schema="public",
        vcluster="default",
    )
