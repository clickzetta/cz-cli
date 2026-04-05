"""Unit tests for integration runner parsing helpers."""

from types import SimpleNamespace

import pytest

from tests.integration.runner import (
    StepExecutionError,
    _extract_json_payload,
    _format_command,
    _run_step,
)


def test_extract_json_payload_from_pretty_multiline_output() -> None:
    output_text = """2026-04-04 12:47:52.536 | INFO     | demo
{
  "ok": true,
  "data": {
    "task_id": 13284059
  },
  "count": 1
}
"""
    payload = _extract_json_payload(output_text)
    assert payload["ok"] is True
    assert payload["data"]["task_id"] == 13284059
    assert payload["count"] == 1


def test_extract_json_payload_strips_ansi_codes() -> None:
    output_text = (
        "2026-04-04 12:47:52.536 | INFO     | demo\n"
        "{\n"
        '  \x1b[37m"ok"\x1b[39;49;00m: true,\n'
        '  \x1b[37m"data"\x1b[39;49;00m: {\n'
        '    \x1b[37m"value"\x1b[39;49;00m: 1\n'
        "  }\n"
        "}\n"
    )
    payload = _extract_json_payload(output_text)
    assert payload["ok"] is True
    assert payload["data"]["value"] == 1


def test_step_execution_error_summary_contains_key_stats() -> None:
    err = StepExecutionError(
        "mock failure",
        scenario_name="studio-task-lifecycle",
        step_name="runs list by task name",
        step_index=9,
        command=["--debug", "--profile", "dev", "runs", "list"],
        attempts=3,
        max_attempts=5,
        last_exit_code=1,
        expected_exit_codes={0},
        output_text="line1\nline2\nline3\n",
    )
    text = err.to_summary()
    assert "scenario: studio-task-lifecycle" in text
    assert "failed_step: #9 runs list by task name" in text
    assert "attempts: 3/5" in text
    assert "exit_code: 1" in text
    assert "expected_exit_codes: [0]" in text
    assert "output_lines: 3" in text


def test_run_step_wraps_parse_failure_with_command_summary() -> None:
    class FakeRunner:
        def invoke(self, *_args, **_kwargs):
            return SimpleNamespace(exit_code=0, output="not-json-output")

    with pytest.raises(StepExecutionError) as exc:
        _run_step(
            cli_runner=FakeRunner(),  # type: ignore[arg-type]
            scenario_name="studio-task-lifecycle",
            index=1,
            step={
                "name": "bad json step",
                "cmd": ["task", "list"],
                "expect": {"exit_code": 0, "ok": True},
            },
            context={},
            base_env={},
            debug_enabled=False,
        )

    summary = exc.value.to_summary()
    assert "cmd: -o pretty task list" in summary
    assert "failed_step: #1 bad json step" in summary


def test_format_command_quotes_special_argument() -> None:
    cmd = [
        "--debug",
        "-o",
        "pretty",
        "task",
        "save",
        "13284061",
        "--content",
        "import time; time.sleep(600)",
    ]
    rendered = _format_command(cmd)
    assert "'import time; time.sleep(600)'" in rendered
