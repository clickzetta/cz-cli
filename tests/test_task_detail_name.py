"""Tests for task detail resolving task name to task id."""

from __future__ import annotations

import json
from types import SimpleNamespace

from click.testing import CliRunner

from cz_cli.commands import task as task_module
from cz_cli.main import cli


def test_task_detail_resolves_name_to_id(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "tasks": [{"task_id": 13284037, "task_name": "demo_python_task"}],
                        "pagination": {"page": 1, "pageSize": 100, "total": 1},
                    }
                )
            if tool_name == "get_task_detail":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "task_detail": {"task_id": 13284037, "task_name": "demo_python_task"},
                    }
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "detail", "demo_python_task"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["task_id"] == 13284037
    assert [name for name, _ in calls] == ["list_clickzetta_tasks", "get_task_detail"]


def test_task_detail_numeric_id_skips_name_lookup(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "get_task_detail":
                return SimpleNamespace(
                    payload={"success": True, "task_detail": {"task_id": 13284037}}
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "detail", "13284037"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["task_id"] == 13284037
    assert [name for name, _ in calls] == ["get_task_detail"]


def test_task_detail_fills_task_id_when_backend_omits_it(monkeypatch):
    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            if tool_name == "get_task_detail":
                return SimpleNamespace(payload={"success": True, "task_detail": {"task_name": "demo_task"}})
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "detail", "13284037"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["task_id"] == 13284037


def test_task_detail_table_output_for_single_record(monkeypatch):
    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "tasks": [{"task_id": 13284037, "task_name": "demo_python_task"}],
                        "pagination": {"page": 1, "pageSize": 100, "total": 1},
                    }
                )
            if tool_name == "get_task_detail":
                return SimpleNamespace(
                    payload={
                        "success": True,
                        "task_detail": {
                            "task_id": 13284037,
                            "task_name": "demo_python_task",
                            "task_type": 26,
                        },
                    }
                )
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "detail", "demo_python_task", "-o", "table"])
    assert result.exit_code == 0, result.output
    assert "task_id" in result.output
    assert "task_name" in result.output
    assert "demo_python_task" in result.output
    assert "|" in result.output
