"""Tests for task/runs command registration and option parsing."""

from click.testing import CliRunner

from cz_cli.main import cli


def test_root_help_includes_task_and_runs():
    runner = CliRunner()
    result = runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "task" in result.output
    assert "runs" in result.output
    assert "executions" in result.output


def test_task_help_includes_flow_group():
    runner = CliRunner()
    result = runner.invoke(cli, ["task", "--help"])
    assert result.exit_code == 0
    assert "flow" in result.output
    assert "create" in result.output
    assert "create-folder" in result.output
    assert "online" in result.output
    assert "execute" in result.output
    assert "publish" not in result.output


def test_profile_show_help_is_available():
    runner = CliRunner()
    result = runner.invoke(cli, ["profile", "show", "--help"])
    assert result.exit_code == 0
    assert "NAME" in result.output
    assert "--mask" in result.output


def test_profile_create_help_accepts_jdbc_url():
    runner = CliRunner()
    result = runner.invoke(cli, ["profile", "create", "--help"])
    assert result.exit_code == 0
    assert "--jdbc" in result.output


def test_global_jdbc_option_is_accepted_for_subcommands():
    runner = CliRunner()
    result = runner.invoke(
        cli,
        [
            "--jdbc",
            "jdbc:clickzetta://inst.dev-api.clickzetta.com/ws?username=u&password=p",
            "profile",
            "list",
        ],
    )
    assert result.exit_code == 0, result.output


def test_runs_stop_accepts_force_flag():
    runner = CliRunner()
    result = runner.invoke(cli, ["runs", "stop", "--help"])
    assert result.exit_code == 0
    assert "-y" in result.output
    assert "--debug" in result.output
    assert "--mcp-log-level" not in result.output


def test_runs_list_accepts_limit_flag():
    runner = CliRunner()
    result = runner.invoke(cli, ["runs", "list", "--help"])
    assert result.exit_code == 0
    assert "--limit" in result.output
    assert "--run-type" in result.output


def test_runs_wait_help_includes_polling_options():
    runner = CliRunner()
    result = runner.invoke(cli, ["runs", "wait", "--help"])
    assert result.exit_code == 0
    assert "RUN_ID_OR_TASK_NAME" in result.output
    assert "--interval" in result.output
    assert "--attempts" in result.output


def test_runs_refill_help_and_force_flag():
    runner = CliRunner()
    result = runner.invoke(cli, ["runs", "refill", "--help"])
    assert result.exit_code == 0
    assert "TASK_NAME_OR_ID" in result.output
    assert "-y" in result.output
    assert "--from" in result.output
    assert "--to" in result.output


def test_task_list_accepts_limit_flag():
    runner = CliRunner()
    result = runner.invoke(cli, ["task", "list", "--help"])
    assert result.exit_code == 0
    assert "--limit" in result.output


def test_task_detail_help_uses_task_name_or_id():
    runner = CliRunner()
    result = runner.invoke(cli, ["task", "detail", "--help"])
    assert result.exit_code == 0
    assert "TASK_NAME_OR_ID" in result.output


def test_task_publish_command_removed():
    runner = CliRunner()
    result = runner.invoke(cli, ["task", "publish", "--help"])
    assert result.exit_code != 0
    assert "No such command 'publish'" in result.output


def test_task_execute_help_uses_task_name_or_id():
    runner = CliRunner()
    result = runner.invoke(cli, ["task", "execute", "--help"])
    assert result.exit_code == 0
    assert "TASK_NAME_OR_ID" in result.output
    assert "--vc" in result.output
    assert "--schema" in result.output
    assert "--param" in result.output


def test_runs_detail_help_uses_run_or_task_name():
    runner = CliRunner()
    result = runner.invoke(cli, ["runs", "detail", "--help"])
    assert result.exit_code == 0
    assert "RUN_ID_OR_TASK_NAME" in result.output
    normalized = " ".join(result.output.split())
    assert "Prefer task_name; numeric input is treated as run_id." in normalized


def test_runs_stop_allows_subcommand_debug_flag(monkeypatch):
    from types import SimpleNamespace
    from cz_cli.commands import runs as runs_module

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            if tool_name == "kill_task_instance":
                return SimpleNamespace(
                    payload={"success": True, "task_instance_id": arguments.get("task_instance_id")}
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(runs_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(
        cli,
        ["runs", "stop", "1001", "--debug", "-y"],
    )
    assert result.exit_code == 0, result.output
    assert '"ok": true' in result.output


def test_executions_log_help_clarifies_run_id_semantics():
    runner = CliRunner()
    result = runner.invoke(cli, ["executions", "log", "--help"])
    assert result.exit_code == 0
    normalized = " ".join(result.output.split())
    assert "argument is run_id/task_name, not execution_id." in normalized


def test_executions_stop_help_accepts_force_flag():
    runner = CliRunner()
    result = runner.invoke(cli, ["executions", "stop", "--help"])
    assert result.exit_code == 0
    assert "RUN_ID_OR_TASK_NAME" in result.output
    assert "-y" in result.output
    assert "--debug" in result.output


def test_executions_list_help_recommends_task_name():
    runner = CliRunner()
    result = runner.invoke(cli, ["executions", "list", "--help"])
    assert result.exit_code == 0
    normalized = " ".join(result.output.split())
    assert "Prefer task_name; numeric input is treated as run_id." in normalized


def test_ai_guide_help_accepts_wide_flag():
    runner = CliRunner()
    result = runner.invoke(cli, ["ai-guide", "--help"])
    assert result.exit_code == 0
    assert "--wide" in result.output
