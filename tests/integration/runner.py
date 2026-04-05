"""Scenario-driven integration test runner (serial, real Studio only)."""

from __future__ import annotations

import json
import os
import secrets
import re
import shlex
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import yaml
from click.testing import CliRunner

from cz_cli.main import cli

_MISSING = object()
_ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


class StepExecutionError(AssertionError):
    """Structured step failure used to render concise scenario-level reports."""

    def __init__(
        self,
        message: str,
        *,
        scenario_name: str,
        step_name: str,
        step_index: int,
        command: list[Any],
        attempts: int,
        max_attempts: int,
        last_exit_code: int | None,
        expected_exit_codes: set[int],
        output_text: str,
    ) -> None:
        super().__init__(message)
        self.scenario_name = scenario_name
        self.step_name = step_name
        self.step_index = step_index
        self.command = command
        self.attempts = attempts
        self.max_attempts = max_attempts
        self.last_exit_code = last_exit_code
        self.expected_exit_codes = expected_exit_codes
        self.output_text = output_text

    def to_summary(self) -> str:
        lines = self.output_text.splitlines()
        tail = "\n".join(lines[-20:]) if lines else "(no output)"
        return "\n".join(
            [
                f"scenario: {self.scenario_name}",
                f"failed_step: #{self.step_index} {self.step_name}",
                f"attempts: {self.attempts}/{self.max_attempts}",
                f"exit_code: {self.last_exit_code}",
                f"expected_exit_codes: {sorted(self.expected_exit_codes)}",
                f"cmd: {_format_command(self.command)}",
                f"output_lines: {len(lines)}",
                f"output_chars: {len(self.output_text)}",
                "output_tail:",
                tail,
                f"reason: {self.args[0]}",
            ]
        )


def _is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _format_command(cmd: list[Any]) -> str:
    return shlex.join(str(part) for part in cmd)


def _colorize_log_line(line: str) -> str:
    if not line:
        return line
    if os.environ.get("NO_COLOR"):
        return line
    force = (os.environ.get("CZ_FORCE_COLOR") or os.environ.get("CLICOLOR_FORCE") or "").strip().lower()
    use_color = sys.stdout.isatty() or force in {"1", "true", "yes"}
    if not use_color:
        return line
    if " | ERROR    | " in line:
        return f"\x1b[31m{line}\x1b[0m"
    if " | WARNING  | " in line:
        return f"\x1b[33m{line}\x1b[0m"
    if " | INFO     | " in line:
        return f"\x1b[36m{line}\x1b[0m"
    if " | DEBUG    | " in line:
        return f"\x1b[90m{line}\x1b[0m"
    if line.startswith("{") and "\"ok\": false" in line:
        return f"\x1b[31m{line}\x1b[0m"
    if line.startswith("{") and "\"ok\": true" in line:
        return f"\x1b[32m{line}\x1b[0m"
    return line


def load_integration_scenarios(cases_dir: Path) -> list[dict[str, Any]]:
    scenarios: list[dict[str, Any]] = []
    for file_path in sorted(cases_dir.glob("*.yaml")):
        doc = yaml.safe_load(file_path.read_text(encoding="utf-8")) or {}
        if not isinstance(doc, dict):
            continue
        doc["case_file"] = str(file_path)
        scenarios.append(doc)
    return scenarios


def _render(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, str):
        return value.format_map(context)
    if isinstance(value, list):
        return [_render(item, context) for item in value]
    if isinstance(value, dict):
        return {key: _render(item, context) for key, item in value.items()}
    return value


def _extract_json_payload(output_text: str) -> dict[str, Any]:
    cleaned_text = _ANSI_ESCAPE_RE.sub("", output_text)
    lines = [line.strip() for line in cleaned_text.splitlines() if line.strip()]
    for line in reversed(lines):
        if not (line.startswith("{") and line.endswith("}")):
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload

    decoder = json.JSONDecoder()
    for idx in range(len(cleaned_text) - 1, -1, -1):
        if cleaned_text[idx] != "{":
            continue
        try:
            payload, end = decoder.raw_decode(cleaned_text[idx:])
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        remainder = cleaned_text[idx + end :].strip()
        if remainder:
            continue
        return payload
    raise AssertionError(f"Unable to parse JSON payload from output:\n{cleaned_text}")


def _json_path_get(payload: Any, path: str) -> Any:
    cur = payload
    for part in path.split("."):
        if isinstance(cur, dict):
            if part not in cur:
                return _MISSING
            cur = cur[part]
            continue
        if isinstance(cur, list):
            if not part.isdigit():
                return _MISSING
            idx = int(part)
            if idx < 0 or idx >= len(cur):
                return _MISSING
            cur = cur[idx]
            continue
        return _MISSING
    return cur


def _assert_expectations(step_name: str, result_output: str, payload: dict[str, Any], expect: dict[str, Any]) -> None:
    output_contains = expect.get("output_contains")
    if isinstance(output_contains, str):
        assert output_contains in result_output, f"[{step_name}] Missing output fragment: {output_contains}"
    elif isinstance(output_contains, list):
        for item in output_contains:
            assert str(item) in result_output, f"[{step_name}] Missing output fragment: {item}"

    error_contains = expect.get("error_contains")
    if isinstance(error_contains, str):
        assert error_contains in result_output, f"[{step_name}] Missing error fragment: {error_contains}"

    if "ok" in expect:
        assert payload.get("ok") is expect["ok"], f"[{step_name}] Unexpected ok field: {payload}"

    for path in expect.get("json_path_exists", []) or []:
        value = _json_path_get(payload, path)
        assert value is not _MISSING, f"[{step_name}] Missing JSON path: {path}. Payload={payload}"

    for path, expected_value in (expect.get("json_path_equals", {}) or {}).items():
        value = _json_path_get(payload, path)
        assert value is not _MISSING, f"[{step_name}] Missing JSON path for equality check: {path}. Payload={payload}"
        assert value == expected_value, f"[{step_name}] JSON path {path} expected {expected_value!r}, got {value!r}"


def _matches_accept_error(result_output: str, expect: dict[str, Any]) -> bool:
    accept_error_contains = expect.get("accept_error_contains")
    if isinstance(accept_error_contains, str):
        return accept_error_contains in result_output
    if isinstance(accept_error_contains, list):
        return all(str(item) in result_output for item in accept_error_contains)
    return False


def _capture_values(step_name: str, payload: dict[str, Any], capture_spec: dict[str, Any], context: dict[str, Any]) -> None:
    for var_name, path_spec in capture_spec.items():
        paths = [path_spec] if isinstance(path_spec, str) else list(path_spec or [])
        if not paths:
            raise AssertionError(f"[{step_name}] capture path missing for variable {var_name}")
        for path in paths:
            value = _json_path_get(payload, path)
            if value is _MISSING:
                continue
            context[var_name] = value
            break
        else:
            raise AssertionError(
                f"[{step_name}] Unable to capture variable '{var_name}' from any paths {paths}. Payload={payload}"
            )


def _run_step(
    cli_runner: CliRunner,
    scenario_name: str,
    index: int,
    step: dict[str, Any],
    context: dict[str, Any],
    base_env: dict[str, str],
    debug_enabled: bool,
) -> None:
    __tracebackhide__ = True
    step_name = step.get("name", f"{scenario_name}-step-{index}")
    cmd = _render(step["cmd"], context)
    if not isinstance(cmd, list):
        raise AssertionError(f"[{step_name}] cmd must be a list, got: {cmd!r}")
    if "--output" not in cmd and "-o" not in cmd:
        cmd = ["-o", "pretty", *cmd]
    if debug_enabled and "--debug" not in cmd and "-d" not in cmd:
        cmd = ["--debug", *cmd]
    if debug_enabled:
        print(f"[{scenario_name}::{step_name}] cmd: {_format_command(cmd)}", flush=True)

    input_text = _render(step.get("input"), context) if "input" in step else None
    env = dict(base_env)
    step_env = _render(step.get("env", {}), context)
    if step_env:
        env.update(step_env)
    env.pop("CZ_E2E_FAKE_STUDIO", None)

    expect = _render(step.get("expect", {}), context)
    retry_count = int(step.get("retry_count", 0))
    retry_interval_seconds = float(step.get("retry_interval_seconds", 1))
    expected_exit_code = int(expect.get("exit_code", 0))
    exit_code_in = expect.get("exit_code_in")
    allowed_exit_codes = (
        {int(code) for code in exit_code_in}
        if isinstance(exit_code_in, list) and exit_code_in
        else {expected_exit_code}
    )
    last_result = None
    executed_attempts = 0

    for attempt in range(retry_count + 1):
        result = cli_runner.invoke(cli, cmd, input=input_text, env=env)
        last_result = result
        executed_attempts = attempt + 1
        if debug_enabled:
            print(
                f"[{scenario_name}::{step_name}] attempt {attempt + 1}/{retry_count + 1} exit_code={result.exit_code}",
                flush=True,
            )
            rendered = (result.output or "").rstrip()
            if rendered:
                for line in rendered.splitlines():
                    print(_colorize_log_line(line), flush=True)
            else:
                print(f"[{scenario_name}::{step_name}] (no output)", flush=True)
        if result.exit_code not in allowed_exit_codes:
            if attempt < retry_count:
                time.sleep(retry_interval_seconds)
                continue
            raise StepExecutionError(
                f"exit code expected one of {sorted(allowed_exit_codes)}, got {result.exit_code}",
                scenario_name=scenario_name,
                step_name=step_name,
                step_index=index,
                command=cmd,
                attempts=attempt + 1,
                max_attempts=retry_count + 1,
                last_exit_code=result.exit_code,
                expected_exit_codes=allowed_exit_codes,
                output_text=result.output or "",
            )

        if result.exit_code != expected_exit_code and _matches_accept_error(result.output, expect):
            return

        try:
            payload = _extract_json_payload(result.output)
            _assert_expectations(step_name, result.output, payload, expect)
        except AssertionError as exc:
            if attempt < retry_count:
                time.sleep(retry_interval_seconds)
                continue
            raise StepExecutionError(
                str(exc),
                scenario_name=scenario_name,
                step_name=step_name,
                step_index=index,
                command=cmd,
                attempts=attempt + 1,
                max_attempts=retry_count + 1,
                last_exit_code=result.exit_code,
                expected_exit_codes=allowed_exit_codes,
                output_text=result.output or "",
            ) from exc
        break

    if last_result is None:
        raise StepExecutionError(
            "internal error: no attempt executed",
            scenario_name=scenario_name,
            step_name=step_name,
            step_index=index,
            command=cmd,
            attempts=0,
            max_attempts=retry_count + 1,
            last_exit_code=None,
            expected_exit_codes=allowed_exit_codes,
            output_text="",
        )

    try:
        payload = _extract_json_payload(last_result.output)
    except AssertionError as exc:
        raise StepExecutionError(
            str(exc),
            scenario_name=scenario_name,
            step_name=step_name,
            step_index=index,
            command=cmd,
            attempts=executed_attempts or (retry_count + 1),
            max_attempts=retry_count + 1,
            last_exit_code=last_result.exit_code,
            expected_exit_codes=allowed_exit_codes,
            output_text=last_result.output or "",
        ) from exc
    if step.get("capture"):
        _capture_values(step_name, payload, step["capture"], context)


def run_scenario(cli_runner: CliRunner, scenario: dict[str, Any]) -> None:
    __tracebackhide__ = True
    scenario_name = scenario.get("scenario", "unnamed-scenario")
    profile_name = os.environ.get("CZ_IT_PROFILE") or "dev"
    debug_enabled = _is_truthy(os.environ.get("CZ_IT_DEBUG", "1"))
    now = datetime.now()
    context: dict[str, Any] = {
        "timestamp": time.strftime("%Y%m%d_%H%M%S"),
        "nonce": secrets.token_hex(4),
        "today": now.strftime("%Y-%m-%d"),
        "yesterday": (now - timedelta(days=1)).strftime("%Y-%m-%d"),
        "tomorrow": (now + timedelta(days=1)).strftime("%Y-%m-%d"),
        "env_CZ_IT_PROFILE": profile_name,
    }
    for key, value in os.environ.items():
        context[f"env_{key}"] = value

    for key, value in (scenario.get("vars") or {}).items():
        context[key] = _render(value, context)

    base_env = dict(os.environ)
    base_env.pop("CZ_E2E_FAKE_STUDIO", None)

    normal_steps: list[tuple[int, dict[str, Any]]] = []
    cleanup_steps: list[tuple[int, dict[str, Any]]] = []
    for index, raw_step in enumerate(scenario.get("steps", []) or [], start=1):
        step = raw_step if isinstance(raw_step, dict) else {}
        if step.get("always_run"):
            cleanup_steps.append((index, step))
        else:
            normal_steps.append((index, step))

    completed_normal = 0
    primary_error: StepExecutionError | Exception | None = None
    for index, step in normal_steps:
        try:
            _run_step(cli_runner, scenario_name, index, step, context, base_env, debug_enabled)
            completed_normal += 1
        except Exception as exc:
            primary_error = exc
            break

    cleanup_errors: list[str] = []
    for index, step in cleanup_steps:
        try:
            _run_step(cli_runner, scenario_name, index, step, context, base_env, debug_enabled)
        except Exception as exc:
            step_name = step.get("name", f"{scenario_name}-step-{index}")
            cleanup_errors.append(f"{step_name}: {exc}")

    if primary_error is not None:
        failure_summary_lines = [
            "Scenario failure summary:",
            f"scenario: {scenario_name}",
            f"normal_steps: {completed_normal}/{len(normal_steps)} completed",
            f"cleanup_steps: {len(cleanup_steps)} (always_run)",
        ]
        if isinstance(primary_error, StepExecutionError):
            failure_summary_lines.append(primary_error.to_summary())
        else:
            failure_summary_lines.append(f"reason: {primary_error}")
        if cleanup_errors:
            failure_summary_lines.append("cleanup_failures:")
            for item in cleanup_errors:
                failure_summary_lines.append(f"- {item}")
        raise AssertionError("\n".join(failure_summary_lines)) from primary_error
    if cleanup_errors:
        raise AssertionError("Cleanup steps failed:\n- " + "\n- ".join(cleanup_errors))
