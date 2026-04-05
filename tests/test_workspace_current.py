from click.testing import CliRunner

from cz_cli.main import cli
import cz_cli.commands.workspace as workspace_mod


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def execute(self, _sql: str) -> None:
        return None

    def fetchall(self):
        return self._rows

    def close(self) -> None:
        return None


class _FakeConn:
    def __init__(self, rows):
        self._rows = rows

    def cursor(self):
        return _FakeCursor(self._rows)

    def close(self) -> None:
        return None


def test_workspace_current_supports_tuple_rows(monkeypatch):
    monkeypatch.setattr(
        workspace_mod,
        "get_connection",
        lambda **kwargs: _FakeConn([("wanxin_test_08",)]),
    )

    runner = CliRunner()
    result = runner.invoke(cli, ["workspace", "current", "-o", "json"])

    assert result.exit_code == 0, result.output
    assert '"ok": true' in result.output
    assert '"workspace": "wanxin_test_08"' in result.output


def test_workspace_current_supports_dict_rows(monkeypatch):
    monkeypatch.setattr(
        workspace_mod,
        "get_connection",
        lambda **kwargs: _FakeConn([{"current_workspace()": "wanxin_test_08"}]),
    )

    runner = CliRunner()
    result = runner.invoke(cli, ["workspace", "current", "-o", "json"])

    assert result.exit_code == 0, result.output
    assert '"ok": true' in result.output
    assert '"workspace": "wanxin_test_08"' in result.output


def test_workspace_current_returns_no_result_error(monkeypatch):
    monkeypatch.setattr(
        workspace_mod,
        "get_connection",
        lambda **kwargs: _FakeConn([]),
    )

    runner = CliRunner()
    result = runner.invoke(cli, ["workspace", "current", "-o", "json"])

    assert result.exit_code == 1, result.output
    assert '"code": "NO_RESULT"' in result.output
