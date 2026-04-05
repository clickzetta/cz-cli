"""Shared resolver helpers for Studio task/run command arguments."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Iterable

from cz_cli import output
from cz_cli.studio_client import StudioClient

DEFAULT_RUN_TYPES_FOR_RESOLVE: tuple[int, ...] = (1, 3, 4)


def ensure_tool_success(payload: dict[str, Any], fmt: str) -> None:
    if not payload.get("success", False):
        output.error(
            "STUDIO_API_ERROR",
            payload.get("message", "Unknown Studio API error"),
            fmt=fmt,
            extra={"raw": payload},
        )


def resolve_task_id(client: StudioClient, task_name_or_id: str, fmt: str) -> int:
    raw = str(task_name_or_id).strip()
    if not raw:
        output.error(
            "INVALID_ARGUMENTS",
            "task_name_or_id cannot be empty.",
            fmt=fmt,
            exit_code=output.EXIT_USAGE_ERROR,
        )
    if raw.isdigit():
        return int(raw)

    payload = client.invoke(
        "list_clickzetta_tasks", {"taskName": raw, "page": 1, "pageSize": 100}
    ).payload
    ensure_tool_success(payload, fmt)
    tasks = payload.get("tasks", []) or []
    if not tasks:
        output.error("TASK_NOT_FOUND", f"No task matched name '{raw}'.", fmt=fmt)

    exact_matches = [item for item in tasks if str(item.get("task_name", "")) == raw]
    if exact_matches:
        chosen = exact_matches[0]
    elif len(tasks) == 1:
        chosen = tasks[0]
    else:
        candidates = [
            {"task_id": item.get("task_id"), "task_name": item.get("task_name")}
            for item in tasks[:10]
        ]
        output.error(
            "TASK_AMBIGUOUS",
            f"Multiple tasks matched name '{raw}'. Please use task ID.",
            fmt=fmt,
            extra={"matched_count": len(tasks), "candidates": candidates},
            exit_code=output.EXIT_USAGE_ERROR,
        )

    task_id = chosen.get("task_id")
    if task_id is None:
        output.error("TASK_NOT_FOUND", f"Unable to resolve task_id from name '{raw}'.", fmt=fmt)
    return int(task_id)


def _resolve_task_ids_for_run_lookup(client: StudioClient, task_name: str, fmt: str) -> list[int]:
    payload = client.invoke(
        "list_clickzetta_tasks", {"taskName": task_name, "page": 1, "pageSize": 100}
    ).payload
    ensure_tool_success(payload, fmt)
    tasks = payload.get("tasks", []) or []
    if not tasks:
        output.error("TASK_NOT_FOUND", f"No task matched name '{task_name}'.", fmt=fmt)

    exact_matches = [item for item in tasks if str(item.get("task_name", "")) == task_name]
    if exact_matches:
        task_ids = [
            int(item["task_id"]) for item in exact_matches if item.get("task_id") is not None
        ]
        if task_ids:
            return task_ids
        output.error(
            "TASK_NOT_FOUND", f"Unable to resolve task_id from name '{task_name}'.", fmt=fmt
        )

    if len(tasks) == 1:
        task_id = tasks[0].get("task_id")
        if task_id is None:
            output.error(
                "TASK_NOT_FOUND", f"Unable to resolve task_id from name '{task_name}'.", fmt=fmt
            )
        return [int(task_id)]

    candidates = [
        {"task_id": item.get("task_id"), "task_name": item.get("task_name")} for item in tasks[:10]
    ]
    output.error(
        "TASK_AMBIGUOUS",
        f"Multiple tasks matched name '{task_name}'. Please use task ID.",
        fmt=fmt,
        extra={"matched_count": len(tasks), "candidates": candidates},
        exit_code=output.EXIT_USAGE_ERROR,
    )


def resolve_latest_run_id(
    client: StudioClient,
    fmt: str,
    *,
    task_id: int | None = None,
    run_types: Iterable[int] = DEFAULT_RUN_TYPES_FOR_RESOLVE,
    days: int = 365,
    empty_message: str | None = None,
    fail_if_empty: bool = True,
) -> int | None:
    now = datetime.now()
    left_ms = int((now - timedelta(days=days)).timestamp() * 1000)
    right_ms = int(now.timestamp() * 1000)
    latest_candidates: list[dict[str, Any]] = []

    for run_type in run_types:
        args: dict[str, Any] = {
            "task_run_type": int(run_type),
            "page_index": 1,
            "page_size": 1,
            "query_plan_time_left": left_ms,
            "query_plan_time_right": right_ms,
        }
        if task_id is not None:
            args["task_id"] = task_id
        payload = client.invoke("list_task_run", args).payload
        ensure_tool_success(payload, fmt)
        items = payload.get("task_run_list", []) or []
        if items:
            latest_candidates.append(items[0])

    if not latest_candidates:
        if not fail_if_empty:
            return None
        message = empty_message or (
            f"No runs found in [{(now - timedelta(days=days)).strftime('%Y-%m-%d')}, {now.strftime('%Y-%m-%d')}]."
        )
        output.error("RUN_NOT_FOUND", message, fmt=fmt)

    def _sort_ts(item: dict[str, Any]) -> int:
        for key in (
            "execute_start_time",
            "trigger_time",
            "plan_trigger_time",
            "created_time",
            "task_run_id",
        ):
            value = item.get(key)
            if value is None:
                continue
            try:
                return int(value)
            except (TypeError, ValueError):
                continue
        return 0

    chosen = max(latest_candidates, key=_sort_ts)
    run_id = chosen.get("task_run_id") or chosen.get("task_instance_id") or chosen.get("id")
    if run_id is None:
        output.error("RUN_NOT_FOUND", "Unable to resolve run id from latest run item.", fmt=fmt)
    return int(run_id)


def resolve_run_id_or_task_name(client: StudioClient, run_id_or_task_name: str, fmt: str) -> int:
    raw = str(run_id_or_task_name).strip()
    if not raw:
        output.error(
            "INVALID_ARGUMENTS",
            "run_id_or_task_name cannot be empty.",
            fmt=fmt,
            exit_code=output.EXIT_USAGE_ERROR,
        )
    if raw.isdigit():
        return int(raw)

    task_ids = _resolve_task_ids_for_run_lookup(client, raw, fmt)
    if len(task_ids) == 1:
        run_id = resolve_latest_run_id(
            client,
            fmt,
            task_id=task_ids[0],
            empty_message=(
                f"Task '{raw}' has no runs in "
                f"[{(datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')}, {datetime.now().strftime('%Y-%m-%d')}]. "
                "If this task has never run, run it first or pass a run ID directly."
            ),
        )
        if run_id is None:
            output.error("RUN_NOT_FOUND", f"Task '{raw}' has no runs.", fmt=fmt)
        return int(run_id)

    candidate_runs: list[tuple[int, int]] = []
    for task_id in task_ids:
        run_id = resolve_latest_run_id(client, fmt, task_id=task_id, fail_if_empty=False)
        if run_id is None:
            continue
        detail_payload = client.invoke(
            "get_task_instance_detail", {"task_instance_id": run_id}
        ).payload
        ensure_tool_success(detail_payload, fmt)
        task_detail = detail_payload.get("task_detail") or {}
        ts = 0
        for key in (
            "executeStartTime",
            "triggerTime",
            "planTriggerTime",
            "createdTime",
            "taskInstanceId",
        ):
            value = task_detail.get(key)
            if value is None:
                continue
            try:
                ts = int(value)
                break
            except (TypeError, ValueError):
                continue
        candidate_runs.append((ts, int(run_id)))

    if not candidate_runs:
        output.error(
            "RUN_NOT_FOUND",
            (
                f"Task '{raw}' has no runs in "
                f"[{(datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')}, {datetime.now().strftime('%Y-%m-%d')}]. "
                "If this task has never run, run it first or pass a run ID directly."
            ),
            fmt=fmt,
        )

    return max(candidate_runs, key=lambda item: item[0])[1]
