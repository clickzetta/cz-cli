"""Tests for task save-config tool selection and compatibility."""

from __future__ import annotations

import json
from types import SimpleNamespace

from click.testing import CliRunner

from cz_cli.commands import task as task_module
from cz_cli.main import cli


def test_task_save_config_prefers_cron_tool_when_available(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def has_tool(self, tool_name: str) -> bool:
            return tool_name == "save_task_cron_configuration"

        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "tasks": [{"task_id": 1001, "task_name": "demo_task"}],
                    }
                )
            if tool_name == "save_task_cron_configuration":
                return SimpleNamespace(payload={"success": True, "save_config_result": True})
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "save-config", "demo_task", "--cron", "0 0 2 * * ?"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["task_id"] == 1001
    assert "task online 1001 -y" in payload["ai_message"]
    assert [name for name, _ in calls] == ["list_clickzetta_tasks", "save_task_cron_configuration"]


def test_task_save_config_fallback_adds_rerun_property(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def has_tool(self, tool_name: str) -> bool:
            return False

        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "tasks": [{"task_id": 1002, "task_name": "demo_task"}],
                    }
                )
            if tool_name == "save_task_configuration":
                return SimpleNamespace(payload={"success": True, "task_id": 1002})
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "save-config", "demo_task", "--cron", "0 0 2 * * ?"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["task_id"] == 1002
    assert "task online 1002 -y" in payload["ai_message"]
    assert [name for name, _ in calls] == ["list_clickzetta_tasks", "save_task_configuration"]
    assert calls[1][1]["rerun_property"] == 1


def test_task_save_config_accepts_5_field_cron(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def has_tool(self, tool_name: str) -> bool:
            return tool_name == "save_task_cron_configuration"

        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "tasks": [{"task_id": 1003, "task_name": "demo_task"}],
                    }
                )
            if tool_name == "save_task_cron_configuration":
                return SimpleNamespace(payload={"success": True, "task_id": 1003})
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "save-config", "demo_task", "--cron", "0 2 * * *"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["task_id"] == 1003
    assert "task online 1003 -y" in payload["ai_message"]
    assert calls[1][1]["cron_express"] == "0 0 2 * * *"


def test_task_save_config_rejects_invalid_cron_parts(monkeypatch):
    monkeypatch.setattr(
        task_module,
        "_new_client",
        lambda ctx: (_ for _ in ()).throw(AssertionError("client should not be created")),
    )

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "save-config", "demo_task", "--cron", "0 2 * *"])
    assert result.exit_code == 2, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_ARGUMENTS"
