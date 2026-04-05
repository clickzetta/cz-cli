"""Tests for executions command group."""

from __future__ import annotations

import json
from types import SimpleNamespace

from click.testing import CliRunner

from cz_cli.commands import executions as executions_module
from cz_cli.main import cli


def test_executions_list_resolves_task_name_and_lists_records(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 123, "task_name": "demo_task"}]}
                )
            if tool_name == "list_task_run":
                run_type = arguments.get("task_run_type")
                if run_type in {1, 3}:
                    return SimpleNamespace(payload={"success": True, "task_run_list": []})
                if run_type == 4:
                    return SimpleNamespace(
                        payload={
                            "success": True,
                            "task_run_list": [{"task_run_id": 24617369, "trigger_time": 999}],
                        }
                    )
                raise AssertionError(f"unexpected task_run_type: {run_type}")
            if tool_name == "list_executions":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "executions": [{"execution_id": 9001}],
                        "total_count": 1,
                    }
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(executions_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["executions", "list", "demo_task", "--limit", "1"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"][0]["run_id"] == 24617369
    assert payload["data"][0]["execution_id"] == 9001
    assert [name for name, _ in calls] == [
        "list_clickzetta_tasks",
        "list_task_run",
        "list_task_run",
        "list_task_run",
        "list_executions",
    ]


def test_executions_log_uses_latest_execution_when_not_provided(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 200, "task_name": "demo_task"}]}
                )
            if tool_name == "list_task_run":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "task_run_list": [{"task_run_id": 300, "execute_start_time": 100}],
                    }
                )
            if tool_name == "list_executions":
                return SimpleNamespace(
                    payload={"success": True, "executions": [{"execution_id": 400}]}
                )
            if tool_name == "get_execution_log":
                return SimpleNamespace(
                    payload={"success": True, "execution_id": 400, "log_content": "demo log"}
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(executions_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["executions", "log", "demo_task"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["execution_id"] == 400
    assert payload["data"]["log_content"] == "demo log"


def test_executions_list_without_arg_derives_latest_run(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_task_run":
                run_type = arguments.get("task_run_type")
                if run_type in {1, 3}:
                    return SimpleNamespace(payload={"success": True, "task_run_list": []})
                if run_type == 4:
                    return SimpleNamespace(
                        payload={
                            "success": True,
                            "task_run_list": [{"task_run_id": 777, "trigger_time": 111}],
                        }
                    )
                raise AssertionError(f"unexpected task_run_type: {run_type}")
            if tool_name == "list_executions":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "executions": [{"execution_id": 778}],
                        "total_count": 1,
                    }
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(executions_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["executions", "list"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"][0]["run_id"] == 777
    assert payload["run_id"] == 777
    assert payload["data"][0]["execution_id"] == 778
    assert payload["ai_message"].find("自动选择最近一次运行实例") >= 0
    assert [name for name, _ in calls] == [
        "list_task_run",
        "list_task_run",
        "list_task_run",
        "list_executions",
    ]


def test_executions_stop_calls_kill_task_instance(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 300, "task_name": "demo_task"}]}
                )
            if tool_name == "list_task_run":
                run_type = arguments.get("task_run_type")
                if run_type in {1, 3}:
                    return SimpleNamespace(payload={"success": True, "task_run_list": []})
                if run_type == 4:
                    return SimpleNamespace(
                        payload={
                            "success": True,
                            "task_run_list": [{"task_run_id": 601, "trigger_time": 999}],
                        }
                    )
                raise AssertionError(f"unexpected task_run_type: {run_type}")
            if tool_name == "kill_task_instance":
                return SimpleNamespace(
                    payload={"success": True, "task_instance_id": arguments.get("task_instance_id")}
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(executions_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["executions", "stop", "demo_task", "-y"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["run_id"] == 601
    assert payload["data"]["task_instance_id"] == 601
    assert [name for name, _ in calls] == [
        "list_clickzetta_tasks",
        "list_task_run",
        "list_task_run",
        "list_task_run",
        "kill_task_instance",
    ]


def test_executions_stop_cancel_message_is_explicit(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 300, "task_name": "demo_task"}]}
                )
            if tool_name == "list_task_run":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "task_run_list": [{"task_run_id": 500, "execute_start_time": 100}],
                    }
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(executions_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["executions", "stop", "demo_task"], input="n\n")
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output.strip().splitlines()[-1])
    assert payload["ok"] is True
    assert payload["data"]["executed"] is False
    assert payload["data"]["action"] == "executions.stop"
    assert "No stop action was executed" in payload["data"]["message"]
    assert "kill_task_instance" not in [name for name, _ in calls]


def test_executions_log_returns_run_id_alias(monkeypatch):
    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 200, "task_name": "demo_task"}]}
                )
            if tool_name == "list_task_run":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "task_run_list": [{"task_run_id": 300, "execute_start_time": 100}],
                    }
                )
            if tool_name == "list_executions":
                return SimpleNamespace(payload={"success": True, "executions": [{"execution_id": 401}]})
            if tool_name == "get_execution_log":
                return SimpleNamespace(payload={"success": True, "log_content": "demo"})
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(executions_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["executions", "log", "demo_task"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["run_id"] == 300


def test_runs_stop_cancel_message_is_explicit(monkeypatch):
    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 300, "task_name": "demo_task"}]}
                )
            if tool_name == "list_task_run":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "task_run_list": [{"task_run_id": 500, "execute_start_time": 100}],
                    }
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    from cz_cli.commands import runs as runs_module

    monkeypatch.setattr(runs_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["runs", "stop", "demo_task"], input="n\n")
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output.strip().splitlines()[-1])
    assert payload["ok"] is True
    assert payload["data"]["executed"] is False
    assert "No stop action was executed" in payload["data"]["message"]
