"""Tests for task save content input behavior."""

from __future__ import annotations

import json
from types import SimpleNamespace

from click.testing import CliRunner

from cz_cli.commands import task as task_module
from cz_cli.main import cli


def test_task_save_accepts_short_file_option(monkeypatch, tmp_path):
    calls: list[tuple[str, dict]] = []
    script = tmp_path / "demo_task.py"
    script.write_text("print('hello')\n", encoding="utf-8")

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 2101, "task_name": "demo_task"}]}
                )
            if tool_name == "save_non_integration_task_content":
                return SimpleNamespace(payload={"success": True, "task_id": 2101})
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "save", "demo_task", "-f", str(script)])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is True
    assert payload["data"]["task_id"] == 2101
    assert "task online 2101 -y" in payload["ai_message"]
    assert [name for name, _ in calls] == [
        "list_clickzetta_tasks",
        "save_non_integration_task_content",
    ]
    assert calls[1][1]["task_content"] == "print('hello')\n"
    # CLI must always pass replace_escaped_chars=False so literal \n in source is preserved
    assert calls[1][1].get("replace_escaped_chars") is False


def test_task_save_file_preserves_literal_escape_sequences(monkeypatch, tmp_path):
    """--file: literal \\n inside a Python string literal must not be replaced with a real newline."""
    calls: list[tuple[str, dict]] = []
    # Script with a literal backslash-n inside a string (as it appears in source code)
    script = tmp_path / "script.py"
    script.write_text('col_defs = ",\\n  ".join(["a INT", "b STRING"])\n', encoding="utf-8")

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 999, "task_name": "my_task"}]}
                )
            if tool_name == "save_non_integration_task_content":
                return SimpleNamespace(payload={"success": True, "task_id": 999})
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["task", "save", "my_task", "-f", str(script)])
    assert result.exit_code == 0, result.output
    saved_content = calls[1][1]["task_content"]
    # The literal \n (two chars: backslash + n) must be preserved, not expanded to a real newline
    assert "\\n" in saved_content, "literal \\n was corrupted into a real newline"
    assert calls[1][1].get("replace_escaped_chars") is False


def test_task_save_content_preserves_literal_escape_sequences(monkeypatch):
    """--content: literal \\n passed via shell must not be replaced with a real newline."""
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            calls.append((tool_name, arguments))
            if tool_name == "list_clickzetta_tasks":
                return SimpleNamespace(
                    payload={"success": True, "tasks": [{"task_id": 42, "task_name": "sql_task"}]}
                )
            if tool_name == "save_non_integration_task_content":
                return SimpleNamespace(payload={"success": True, "task_id": 42})
            raise AssertionError(f"unexpected tool call: {tool_name}")

    monkeypatch.setattr(task_module, "_new_client", lambda ctx: FakeClient())

    runner = CliRunner()
    # Simulate shell passing a string that contains literal \n (two chars)
    raw_content = "SELECT 1;\\nSELECT 2;"
    result = runner.invoke(cli, ["task", "save", "sql_task", "--content", raw_content])
    assert result.exit_code == 0, result.output
    saved_content = calls[1][1]["task_content"]
    assert saved_content == raw_content, "content was mutated before saving"
    assert calls[1][1].get("replace_escaped_chars") is False
