"""Canonical identity normalization helpers for task/run payloads."""

from __future__ import annotations

from typing import Any

_RUN_ID_KEYS = (
    "run_id",
    "task_run_id",
    "task_instance_id",
    "taskInstanceId",
    "id",
    "backfill_task_id",
    "complementTaskId",
)
_TASK_ID_KEYS = ("task_id", "schedule_task_id", "scheduleTaskId")
_TASK_NAME_KEYS = ("task_name", "taskName", "cycle_task_name", "cycleTaskName")


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _first(source: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in source and source.get(key) is not None:
            return source.get(key)
    return None


def _pick_int(sources: list[dict[str, Any]], keys: tuple[str, ...]) -> int | None:
    for source in sources:
        value = _as_int(_first(source, keys))
        if value is not None:
            return value
    return None


def _pick_str(sources: list[dict[str, Any]], keys: tuple[str, ...]) -> str | None:
    for source in sources:
        value = _first(source, keys)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def normalize_run_identity(
    payload: dict[str, Any],
    *extra_sources: dict[str, Any] | None,
    fallback_run_id: int | None = None,
) -> dict[str, Any]:
    """Add canonical run/task identity aliases without removing original fields."""
    normalized = dict(payload)
    sources: list[dict[str, Any]] = [payload]
    for item in extra_sources:
        if isinstance(item, dict):
            sources.append(item)

    run_id = _pick_int(sources, _RUN_ID_KEYS)
    if run_id is None:
        run_id = fallback_run_id
    if run_id is not None:
        normalized["run_id"] = int(run_id)

    task_id = _pick_int(sources, _TASK_ID_KEYS)
    if task_id is not None:
        normalized["task_id"] = int(task_id)

    task_name = _pick_str(sources, _TASK_NAME_KEYS)
    if task_name:
        normalized["task_name"] = task_name

    return normalized


def normalize_run_identity_list(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize a list of run/execution records."""
    return [normalize_run_identity(item) for item in items]


def normalize_task_identity(
    payload: dict[str, Any],
    *extra_sources: dict[str, Any] | None,
    fallback_task_id: int | None = None,
) -> dict[str, Any]:
    """Add canonical task identity aliases without removing original fields."""
    normalized = dict(payload)
    sources: list[dict[str, Any]] = [payload]
    for item in extra_sources:
        if isinstance(item, dict):
            sources.append(item)

    task_id = _pick_int(sources, _TASK_ID_KEYS)
    if task_id is None:
        task_id = fallback_task_id
    if task_id is not None:
        normalized["task_id"] = int(task_id)

    task_name = _pick_str(sources, _TASK_NAME_KEYS)
    if task_name:
        normalized["task_name"] = task_name

    return normalized
