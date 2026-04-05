"""Tests for PAT profile behaviors."""

from pathlib import Path

from click.testing import CliRunner

from cz_cli.main import cli
import cz_cli.commands.profile as profile_mod


def _use_temp_profile_store(monkeypatch, tmp_path):
    profile_dir = tmp_path / ".clickzetta"
    profile_file = profile_dir / "profiles.toml"
    monkeypatch.setattr(profile_mod, "_PROFILES_DIR", profile_dir)
    monkeypatch.setattr(profile_mod, "_PROFILES_FILE", profile_file)
    return profile_file


def test_profile_create_with_pat(monkeypatch, tmp_path):
    _use_temp_profile_store(monkeypatch, tmp_path)
    runner = CliRunner()
    result = runner.invoke(
        cli,
        [
            "profile",
            "create",
            "pat_profile",
            "--pat",
            "abc123456789",
            "--instance",
            "inst",
            "--workspace",
            "ws",
            "--service",
            "dev-api.clickzetta.com",
            "--skip-verify",
        ],
    )
    assert result.exit_code == 0

    list_result = runner.invoke(cli, ["profile", "list"])
    assert list_result.exit_code == 0
    assert '"auth_mode": "pat"' in list_result.output
    assert "abc12345****" in list_result.output


def test_profile_create_with_http_protocol(monkeypatch, tmp_path):
    profile_file = _use_temp_profile_store(monkeypatch, tmp_path)
    runner = CliRunner()
    result = runner.invoke(
        cli,
        [
            "profile",
            "create",
            "http_profile",
            "--pat",
            "abc123456789",
            "--service",
            "dev-api.clickzetta.com",
            "--protocol",
            "http",
            "--instance",
            "inst",
            "--workspace",
            "ws",
            "--skip-verify",
        ],
    )
    assert result.exit_code == 0

    text = Path(profile_file).read_text(encoding="utf-8")
    assert 'protocol = "http"' in text

    list_result = runner.invoke(cli, ["profile", "list"])
    assert list_result.exit_code == 0
    assert '"protocol": "http"' in list_result.output


def test_profile_create_pat_and_username_conflict(monkeypatch, tmp_path):
    _use_temp_profile_store(monkeypatch, tmp_path)
    runner = CliRunner()
    result = runner.invoke(
        cli,
        [
            "profile",
            "create",
            "bad_profile",
            "--pat",
            "abc",
            "--username",
            "u",
            "--password",
            "p",
            "--instance",
            "inst",
            "--workspace",
            "ws",
            "--service",
            "dev-api.clickzetta.com",
            "--skip-verify",
        ],
    )
    assert result.exit_code != 0
    assert "Cannot specify both --pat and --username/--password" in result.output


def test_profile_update_to_pat_removes_username_password(monkeypatch, tmp_path):
    profile_file = _use_temp_profile_store(monkeypatch, tmp_path)
    runner = CliRunner()
    create_result = runner.invoke(
        cli,
        [
            "profile",
            "create",
            "u_profile",
            "--username",
            "u",
            "--password",
            "p",
            "--instance",
            "inst",
            "--workspace",
            "ws",
            "--service",
            "dev-api.clickzetta.com",
            "--skip-verify",
        ],
    )
    assert create_result.exit_code == 0

    update_result = runner.invoke(cli, ["profile", "update", "u_profile", "pat", "newpat"])
    assert update_result.exit_code == 0
    text = Path(profile_file).read_text(encoding="utf-8")
    assert 'pat = "newpat"' in text
    assert "username" not in text
    assert "password" not in text


def test_profile_show_returns_full_config(monkeypatch, tmp_path):
    _use_temp_profile_store(monkeypatch, tmp_path)
    runner = CliRunner()
    create_result = runner.invoke(
        cli,
        [
            "profile",
            "create",
            "show_profile",
            "--username",
            "u",
            "--password",
            "p",
            "--instance",
            "inst",
            "--workspace",
            "ws",
            "--service",
            "dev-api.clickzetta.com",
            "--skip-verify",
        ],
    )
    assert create_result.exit_code == 0

    show_result = runner.invoke(cli, ["profile", "show", "show_profile"])
    assert show_result.exit_code == 0
    assert '"name": "show_profile"' in show_result.output
    assert '"username": "u"' in show_result.output
    assert '"password": "p"' in show_result.output


def test_profile_show_mask_hides_sensitive_values(monkeypatch, tmp_path):
    _use_temp_profile_store(monkeypatch, tmp_path)
    runner = CliRunner()
    create_result = runner.invoke(
        cli,
        [
            "profile",
            "create",
            "mask_profile",
            "--pat",
            "abcdefghijk",
            "--instance",
            "inst",
            "--workspace",
            "ws",
            "--service",
            "dev-api.clickzetta.com",
            "--skip-verify",
        ],
    )
    assert create_result.exit_code == 0

    show_result = runner.invoke(cli, ["profile", "show", "mask_profile", "--mask"])
    assert show_result.exit_code == 0
    assert "abcdefgh" in show_result.output
    assert "****" in show_result.output
    assert "abcdefghijk" not in show_result.output


def test_profile_create_with_jdbc_url(monkeypatch, tmp_path):
    profile_file = _use_temp_profile_store(monkeypatch, tmp_path)
    runner = CliRunner()
    jdbc_url = "jdbc:clickzetta://inst_jdbc.dev-api.clickzetta.com/ws_jdbc?username=u_jdbc&password=p_jdbc&schema=s_jdbc&virtualCluster=vc_jdbc&protocol=http"
    result = runner.invoke(
        cli,
        [
            "profile",
            "create",
            "jdbc_profile",
            "--jdbc",
            jdbc_url,
            "--skip-verify",
        ],
    )
    assert result.exit_code == 0, result.output

    text = Path(profile_file).read_text(encoding="utf-8")
    assert 'service = "dev-api.clickzetta.com"' in text
    assert 'instance = "inst_jdbc"' in text
    assert 'workspace = "ws_jdbc"' in text
    assert 'schema = "s_jdbc"' in text
    assert 'vcluster = "vc_jdbc"' in text
    assert 'protocol = "http"' in text
    assert 'username = "u_jdbc"' in text
    assert 'password = "p_jdbc"' in text


def test_profile_create_with_jdbc_url_and_cli_override(monkeypatch, tmp_path):
    profile_file = _use_temp_profile_store(monkeypatch, tmp_path)
    runner = CliRunner()
    jdbc_url = (
        "jdbc:clickzetta://inst_jdbc.dev-api.clickzetta.com/ws_jdbc?username=u_jdbc&password=p_jdbc"
    )
    result = runner.invoke(
        cli,
        [
            "profile",
            "create",
            "jdbc_override",
            "--jdbc",
            jdbc_url,
            "--workspace",
            "ws_override",
            "--protocol",
            "http",
            "--skip-verify",
        ],
    )
    assert result.exit_code == 0, result.output

    text = Path(profile_file).read_text(encoding="utf-8")
    assert 'workspace = "ws_override"' in text
    assert 'protocol = "http"' in text


def test_profile_create_with_instance_prefixed_jdbc_url(monkeypatch, tmp_path):
    profile_file = _use_temp_profile_store(monkeypatch, tmp_path)
    runner = CliRunner()
    jdbc_url = (
        "jdbc:clickzetta://tmwmzxzs.dev-api.clickzetta.com/wanxin_test_08"
        "?username=studi_test_1&password=Abc123456&schema=public&virtualCluster=default"
    )
    result = runner.invoke(
        cli,
        [
            "profile",
            "create",
            "devjdbc",
            "--jdbc",
            jdbc_url,
            "--skip-verify",
        ],
    )
    assert result.exit_code == 0, result.output

    text = Path(profile_file).read_text(encoding="utf-8")
    assert 'service = "dev-api.clickzetta.com"' in text
    assert 'instance = "tmwmzxzs"' in text
    assert 'workspace = "wanxin_test_08"' in text
