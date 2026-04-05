"""Tests for task/runs commands accepting name-or-id inputs."""

from __future__ import annotations

import json
from types import SimpleNamespace

from click.testing import CliRunner

from cz_cli.commands import runs as runs_module
from cz_cli.commands import task as task_module
from cz_cli.main import cli


def test_task_online_resolves_task_name(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 101, "task_name": "demo_task"}]}
                )
            if tool_name == "get_task_detail":
                return SimpleNamespace(
                    payload={"success": True, "task_detail": {"task_id": 101, "current_version": 3}}
                )
            if tool_name == "publish_task":
                return SimpleNamespace(payload={"success": True, "task_id": 101, "task_version": 3})
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "online", "demo_task", "-y"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert [name for name, _ in calls] == [
        "list_clickzetta_tasks",
        "get_task_detail",
        "publish_task",
    ]


def test_task_online_rejects_flow_task(monkeypatch):
    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 112, "task_name": "demo_flow"}]}
                )
            if tool_name == "get_task_detail":
                return SimpleNamespace(
                    payload={"success": True, "task_detail": {"task_id": 112, "task_type": 500}}
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "online", "demo_flow", "-y"])
    assert result.exit_code == 2, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_ARGUMENTS"
    assert "task flow submit" in payload["error"]["message"]


def test_runs_list_resolves_task_name(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 202, "task_name": "demo_task"}]}
                )
            if tool_name == "list_task_run":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "task_run_list": [{"task_run_id": 3001}],
                        "total_count": 1,
                        "page_index": 1,
                    }
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(runs_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["runs", "list", "--task", "demo_task", "--limit", "1"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"][0]["run_id"] == 3001
    assert [name for name, _ in calls] == ["list_clickzetta_tasks", "list_task_run"]
    assert calls[1][1]["task_id"] == 202
    assert calls[1][1]["task_run_type"] == 1


def test_runs_list_accepts_run_type_refill(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 202, "task_name": "demo_task"}]}
                )
            if tool_name == "list_task_run":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "task_run_list": [{"task_run_id": 3001}],
                        "total_count": 1,
                        "page_index": 1,
                    }
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(runs_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(
        cli, ["runs", "list", "--task", "demo_task", "--run-type", "4", "--limit", "1"]
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert calls[1][1]["task_run_type"] == 4


def test_runs_detail_resolves_latest_run_from_task_name(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 303, "task_name": "demo_task"}]}
                )
            if tool_name == "list_task_run":
                run_type = arguments.get("task_run_type")
                if run_type == 1:
                    return SimpleNamespace(
                        payload={
                            "success": True,
                            "task_run_list": [{"task_run_id": 9001, "execute_start_time": 100}],
                            "total_count": 1,
                            "page_index": 1,
                        }
                    )
                if run_type == 3:
                    return SimpleNamespace(
                        payload={
                            "success": True,
                            "task_run_list": [{"task_run_id": 9002, "execute_start_time": 200}],
                            "total_count": 1,
                            "page_index": 1,
                        }
                    )
                if run_type == 4:
                    return SimpleNamespace(
                        payload={
                            "success": True,
                            "task_run_list": [{"task_run_id": 9003, "execute_start_time": 300}],
                            "total_count": 1,
                            "page_index": 1,
                        }
                    )
                raise AssertionError(f"unexpected task_run_type: {run_type}")
            if tool_name == "get_task_instance_detail":
                return SimpleNamespace(
                    payload={"success": True, "task_instance_id": 9003, "status": "FAILED"}
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(runs_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["runs", "detail", "demo_task"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["run_id"] == 9003
    assert payload["data"]["task_instance_id"] == 9003
    assert [name for name, _ in calls] == [
        "list_clickzetta_tasks",
        "list_task_run",
        "list_task_run",
        "list_task_run",
        "get_task_instance_detail",
    ]


def test_runs_detail_fallback_to_type4_when_type1_empty(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 404, "task_name": "demo_task"}]}
                )
            if tool_name == "list_task_run":
                run_type = arguments.get("task_run_type")
                if run_type in {1, 3}:
                    return SimpleNamespace(
                        payload={
                            "success": True,
                            "task_run_list": [],
                            "total_count": 0,
                            "page_index": 1,
                        }
                    )
                if run_type == 4:
                    return SimpleNamespace(
                        payload={
                            "success": True,
                            "task_run_list": [{"task_run_id": 9404, "trigger_time": 999}],
                            "total_count": 1,
                            "page_index": 1,
                        }
                    )
                raise AssertionError(f"unexpected task_run_type: {run_type}")
            if tool_name == "get_task_instance_detail":
                return SimpleNamespace(
                    payload={"success": True, "task_instance_id": 9404, "status": "FAILED"}
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(runs_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["runs", "detail", "demo_task"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["run_id"] == 9404
    assert payload["data"]["task_instance_id"] == 9404


def test_runs_refill_resolves_task_name(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 505, "task_name": "demo_task"}]}
                )
            if tool_name == "create_backfill_job":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "backfill_task_id": 88001,
                        "schedule_task_id": arguments.get("schedule_task_id"),
                    }
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(runs_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(
        cli, ["runs", "refill", "demo_task", "--from", "2026-04-02", "--to", "2026-04-03", "-y"]
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["run_id"] == 88001
    assert payload["data"]["backfill_task_id"] == 88001
    assert [name for name, _ in calls] == ["list_clickzetta_tasks", "create_backfill_job"]
    assert calls[1][1]["schedule_task_id"] == 505


def test_runs_refill_cancel_message_is_explicit(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 606, "task_name": "demo_task"}]}
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(runs_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(
        cli,
        ["runs", "refill", "demo_task", "--from", "2026-04-02", "--to", "2026-04-03"],
        input="n\n",
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output.strip().splitlines()[-1])
    assert payload["ok"] is True
    assert payload["data"]["executed"] is False
    assert payload["data"]["action"] == "runs.refill"
    assert "No refill action was executed" in payload["data"]["message"]
    assert "create_backfill_job" not in [name for name, _ in calls]
    assert "确认为任务 606 提交补数任务吗？" in result.stderr
    assert "确认为任务 606 提交补数任务吗？" not in result.stdout


def test_runs_refill_defaults_to_immediate_single_window(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 707, "task_name": "demo_task"}]}
                )
            if tool_name == "create_backfill_job":
                return SimpleNamespace(payload={"success": True, "backfill_task_id": 99001})
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(runs_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["runs", "refill", "demo_task", "-y"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["run_id"] == 99001
    assert [name for name, _ in calls] == ["list_clickzetta_tasks", "create_backfill_job"]
    assert isinstance(calls[1][1]["biz_start_time"], int)
    assert isinstance(calls[1][1]["biz_end_time"], int)
    assert calls[1][1]["biz_start_time"] == calls[1][1]["biz_end_time"]


def test_runs_refill_requires_from_and_to_together(monkeypatch):
    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 808, "task_name": "demo_task"}]}
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(runs_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["runs", "refill", "demo_task", "--from", "2026-04-02", "-y"])
    assert result.exit_code == 2, result.output
    payload = json.loads(result.output.strip().splitlines()[-1])
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_ARGUMENTS"


def test_runs_wait_polls_until_terminal_success(monkeypatch):
    calls: list[tuple[str, dict]] = []
    statuses = [4, 4, 1]

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "get_task_instance_detail":
                status = statuses.pop(0)
                return SimpleNamespace(
                    payload={"success": True, "task_detail": {"instanceStatus": status}}
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(runs_module, "_new_client", lambda ctx: FakeClient())
    monkeypatch.setattr(runs_module.time, "sleep", lambda _s: None)

    runner = CliRunner()
    result = runner.invoke(cli, ["runs", "wait", "9001", "--interval", "0.1", "--attempts", "5"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["polling"]["attempts_used"] == 3
    assert payload["polling"]["terminal_status"] == "SUCCESS"
    assert [name for name, _ in calls] == [
        "get_task_instance_detail",
        "get_task_instance_detail",
        "get_task_instance_detail",
    ]


def test_runs_wait_timeout_returns_error_by_default(monkeypatch):
    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            if tool_name == "get_task_instance_detail":
                return SimpleNamespace(
                    payload={"success": True, "task_detail": {"instanceStatus": 4}}
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(runs_module, "_new_client", lambda ctx: FakeClient())
    monkeypatch.setattr(runs_module.time, "sleep", lambda _s: None)

    runner = CliRunner()
    result = runner.invoke(cli, ["runs", "wait", "9002", "--interval", "0.1", "--attempts", "2"])
    assert result.exit_code == 1, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "RUN_WAIT_TIMEOUT"


def test_runs_wait_allow_timeout_returns_success(monkeypatch):
    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            if tool_name == "get_task_instance_detail":
                return SimpleNamespace(
                    payload={"success": True, "task_detail": {"instanceStatus": 4}}
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(runs_module, "_new_client", lambda ctx: FakeClient())
    monkeypatch.setattr(runs_module.time, "sleep", lambda _s: None)

    runner = CliRunner()
    result = runner.invoke(
        cli,
        ["runs", "wait", "9003", "--interval", "0.1", "--attempts", "2", "--allow-timeout"],
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["run_id"] == 9003
    assert payload["data"]["attempts_used"] == 2
