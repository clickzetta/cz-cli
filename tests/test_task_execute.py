"""Tests for task temporary execute command."""

from __future__ import annotations

import json
from types import SimpleNamespace

from click.testing import CliRunner

from cz_cli.commands import task as task_module
from cz_cli.main import cli


def test_task_execute_resolves_name_and_uses_task_detail_defaults(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def has_tool(self, tool_name: str) -> bool:
            return tool_name == "execute_task"

        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 901, "task_name": "demo_task"}]}
                )
            if tool_name == "get_task_detail":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "task_detail": {
                            "task_id": 901,
                            "task_content": "print('temp run')",
                            "default_vc_name": "DEFAULT",
                            "default_schema_name": "public",
                        },
                    }
                )
            if tool_name == "execute_task":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "task_instance_id": 7001,
                        "execution_status": "SUCCESS",
                        "task_detail": {"taskInstanceId": 7001, "scheduleTaskId": 901},
                    }
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "execute", "demo_task"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["task_id"] == 901
    assert payload["data"]["run_id"] == 7001
    assert "run_id=7001" in payload["ai_message"]
    assert calls[2][0] == "execute_task"
    assert calls[2][1]["data_task_id"] == 901
    assert calls[2][1]["data_task_content"] == "print('temp run')"
    assert calls[2][1]["adhoc_vc_code"] == "DEFAULT"
    assert calls[2][1]["adhoc_schema_name"] == "public"


def test_task_execute_allows_content_and_param_override(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def has_tool(self, tool_name: str) -> bool:
            return tool_name == "execute_task"

        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "get_task_detail":
                return SimpleNamespace(
                    payload={"success": True, "task_detail": {"task_id": 902, "default_vc_name": "DEFAULT"}}
                )
            if tool_name == "execute_task":
                return SimpleNamespace(
                    payload={"success": True, "task_instance_id": 7002, "execution_status": "SUCCESS"}
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(
        cli,
        [
            "task",
            "execute",
            "902",
            "--content",
            "select 1",
            "--vc",
            "adhoc_vc",
            "--schema",
            "bulkload_test",
            "--param",
            "dt=2026-04-05",
            "--param",
            "k=v",
        ],
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["run_id"] == 7002
    execute_args = calls[1][1]
    assert execute_args["data_task_content"] == "select 1"
    assert execute_args["adhoc_vc_code"] == "adhoc_vc"
    assert execute_args["adhoc_schema_name"] == "bulkload_test"
    assert execute_args["params"] == {"dt": "2026-04-05", "k": "v"}


def test_task_execute_requires_execute_tool_support(monkeypatch):
    class FakeClient:
        def has_tool(self, tool_name: str) -> bool:
            return False

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "execute", "demo_task"])
    assert result.exit_code == 2, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_ARGUMENTS"


def test_task_execute_requires_content_when_task_detail_empty(monkeypatch):
    class FakeClient:
        def has_tool(self, tool_name: str) -> bool:
            return tool_name == "execute_task"

        def invoke(self, tool_name: str, arguments: dict):
            if tool_name == "get_task_detail":
                return SimpleNamespace(
                    payload={"success": True, "task_detail": {"task_id": 903, "default_vc_name": "DEFAULT"}}
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "execute", "903"])
    assert result.exit_code == 2, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_ARGUMENTS"


def test_task_execute_validates_param_syntax(monkeypatch):
    class FakeClient:
        def has_tool(self, tool_name: str) -> bool:
            return tool_name == "execute_task"

        def invoke(self, tool_name: str, arguments: dict):
            if tool_name == "get_task_detail":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "task_detail": {
                            "task_id": 904,
                            "task_content": "select 1",
                            "default_vc_name": "DEFAULT",
                        },
                    }
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "execute", "904", "--param", "bad"])
    assert result.exit_code == 2, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_ARGUMENTS"
