"""Tests for task create and create-folder commands."""

from __future__ import annotations

import json
from types import SimpleNamespace

from click.testing import CliRunner

from cz_cli.commands import task as task_module
from cz_cli.main import cli


def test_task_create_folder_invokes_create_folder_tool(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "create_folder":
                return SimpleNamespace(payload={"success": True, "folder_id": 999})
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["task", "create-folder", "demo_folder", "--parent", "0"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert [name for name, _ in calls] == ["create_folder"]


def test_task_create_invokes_create_task_tool(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "create_task":
                return SimpleNamespace(payload={"success": True, "task_id": 13284037})
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())
    runner = CliRunner()
    result = runner.invoke(
        cli,
        [
            "task",
            "create",
            "demo_python_task",
            "--type",
            "PYTHON",
            "--folder",
            "0",
            "--description",
            "demo",
        ],
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert [name for name, _ in calls] == ["create_task"]
    assert calls[0][1]["task_type"] == 26


def test_task_create_accepts_folder_id_alias(monkeypatch):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "create_task":
                return SimpleNamespace(payload={"success": True, "task_id": 13284037})
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())
    runner = CliRunner()
    result = runner.invoke(
        cli,
        [
            "task",
            "create",
            "demo_python_task",
            "--type",
            "PYTHON",
            "--folder-id",
            "123",
        ],
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert [name for name, _ in calls] == ["create_task"]
    assert calls[0][1]["data_folder_id"] == 123


def test_task_create_requires_type(monkeypatch):
    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())
    runner = CliRunner()
    result = runner.invoke(
        cli,
        [
            "task",
            "create",
            "demo_task",
            "--folder",
            "0",
        ],
    )
    assert result.exit_code == 2
    assert "Missing option '--type'" in result.output
