"""Studio runs commands."""

from __future__ import annotations

from datetime import datetime, timedelta
import time
from typing import Any

import click

from cz_cli import output
from cz_cli.cli_group import CLIGroup
from cz_cli.logger import log_operation
from cz_cli.studio_identity import normalize_run_identity, normalize_run_identity_list
from cz_cli.studio_resolver import ensure_tool_success, resolve_run_id_or_task_name, resolve_task_id
from cz_cli.studio_client import StudioClient, configure_mcp_logging, studio_connection_kwargs

_RUN_STATUS_MAP = {
    "SUCCESS": 1,
    "WAITING": 2,
    "FAILED": 3,
    "RUNNING": 4,
}
_RUN_STATUS_NAME_BY_CODE = {value: key for key, value in _RUN_STATUS_MAP.items()}
_RUN_TYPE_MAP = {
    "SCHEDULE": 1,
    "TEMP": 3,
    "REFILL": 4,
    "1": 1,
    "3": 3,
    "4": 4,
}


def _new_client(ctx: click.Context) -> StudioClient:
    configure_mcp_logging("DEBUG" if ctx.obj.get("debug") else None)
    return StudioClient(
        profile=ctx.obj.get("profile"),
        jdbc_url=ctx.obj.get("jdbc_url"),
        **studio_connection_kwargs(ctx.obj),
    )


def _ensure_success(payload: dict[str, Any], fmt: str) -> None:
    ensure_tool_success(payload, fmt)


def _parse_datetime_to_ms(value: str | None, default: datetime) -> int:
    if not value:
        return int(default.timestamp() * 1000)
    parsed = datetime.fromisoformat(value)
    return int(parsed.timestamp() * 1000)


def _parse_window_boundary_to_ms(value: str, *, end_of_day: bool = False) -> int:
    # Accept both YYYY-MM-DD and ISO datetime.
    if len(value) == 10 and value.count("-") == 2:
        date_part = datetime.fromisoformat(value)
        if end_of_day:
            date_part = date_part.replace(hour=23, minute=59, second=59, microsecond=999000)
        return int(date_part.timestamp() * 1000)
    parsed = datetime.fromisoformat(value)
    return int(parsed.timestamp() * 1000)


def _extract_run_status(detail_payload: dict[str, Any]) -> tuple[int | None, Any, Any]:
    task_detail = detail_payload.get("task_detail")
    detail_obj = task_detail if isinstance(task_detail, dict) else {}
    status_code = detail_obj.get("instanceStatus")
    if status_code is None:
        status_code = detail_payload.get("status_code")
    end_time = detail_obj.get("executeEndTime")
    fail_msg = detail_obj.get("failMsg")
    return status_code, end_time, fail_msg


@click.group("runs", cls=CLIGroup)
@click.pass_context
def runs_cmd(ctx: click.Context) -> None:
    """Manage Studio task run instances."""


@runs_cmd.command("list", help="List task run instances. Defaults to SCHEDULE runs, last 24h, page 1. Use --run-type REFILL for backfill runs. Check ai_message for total count and pagination hints.")
@click.option("--task", "task_name_or_id", type=str, help="Task ID or name filter.")
@click.option(
    "--status",
    "statuses",
    multiple=True,
    type=click.Choice(list(_RUN_STATUS_MAP.keys())),
    help="Status filter.",
)
@click.option(
    "--run-type",
    "run_type",
    type=click.Choice(list(_RUN_TYPE_MAP.keys()), case_sensitive=False),
    default="SCHEDULE",
    show_default=True,
    help="Run type filter: SCHEDULE(1), TEMP(3), REFILL(4).",
)
@click.option("--from", "from_time", help="Start time (ISO format, e.g. 2026-04-03T00:00:00).")
@click.option("--to", "to_time", help="End time (ISO format, e.g. 2026-04-03T23:59:59).")
@click.option("--page", type=int, default=1, show_default=True, help="Page index.")
@click.option(
    "--page-size", "page_size", type=int, default=10, show_default=True, help="Page size."
)
@click.option("--limit", type=click.IntRange(min=1), help="Alias of --page-size.")
@click.pass_context
def runs_list(
    ctx: click.Context,
    task_name_or_id: str | None,
    statuses: tuple[str, ...],
    run_type: str,
    from_time: str | None,
    to_time: str | None,
    page: int,
    page_size: int,
    limit: int | None,
) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    if limit is not None:
        page_size = int(limit)
    now = datetime.now()
    left_ms = _parse_datetime_to_ms(from_time, now - timedelta(days=1))
    right_ms = _parse_datetime_to_ms(to_time, now)
    resolved_run_type = _RUN_TYPE_MAP[run_type.upper()]
    args: dict[str, Any] = {
        "page_index": page,
        "page_size": page_size,
        "query_plan_time_left": left_ms,
        "query_plan_time_right": right_ms,
        "task_run_type": resolved_run_type,
    }
    if task_name_or_id:
        args["task_id"] = resolve_task_id(client, task_name_or_id, fmt)
    if statuses:
        args["task_run_status_list"] = [_RUN_STATUS_MAP[s] for s in statuses]
    payload = client.invoke("list_task_run", args).payload
    _ensure_success(payload, fmt)
    items = normalize_run_identity_list(payload.get("task_run_list", []))
    total = payload.get("total_count")
    ai_message = (
        f"当前仅展示第 {payload.get('page_index', page)} 页"
        + (f"（{len(items)} 条 / 共 {total} 条）" if total is not None else "")
        + f"，run_type={resolved_run_type}"
        + f"。如需下一页，请执行: cz-cli runs list --run-type {resolved_run_type} --page {page + 1} --page-size {page_size}"
    )
    log_operation("runs list", ok=True)
    output.success(
        items,
        fmt=fmt,
        ai_message=ai_message,
        extra={"pagination": {"page": page, "page_size": page_size, "total": total}},
    )


@runs_cmd.command("detail", help="Get full detail of one run instance by run_id or task_name (resolves latest run).")
@click.argument("run_id_or_task_name", type=str)
@click.pass_context
def runs_detail(ctx: click.Context, run_id_or_task_name: str) -> None:
    """Get run detail by run_id or task_name. Prefer task_name; numeric input is treated as run_id."""
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    run_id = resolve_run_id_or_task_name(client, run_id_or_task_name, fmt)
    payload = client.invoke("get_task_instance_detail", {"task_instance_id": run_id}).payload
    _ensure_success(payload, fmt)
    detail_obj = payload.get("task_detail") if isinstance(payload.get("task_detail"), dict) else {}
    normalized_payload = normalize_run_identity(payload, detail_obj, fallback_run_id=run_id)
    log_operation("runs detail", ok=True)
    output.success(normalized_payload, fmt=fmt)


@runs_cmd.command("wait")
@click.argument("run_id_or_task_name", type=str)
@click.option(
    "--interval",
    type=click.FloatRange(min=0.1),
    default=5.0,
    show_default=True,
    help="Polling interval in seconds.",
)
@click.option(
    "--attempts",
    type=click.IntRange(min=1),
    default=120,
    show_default=True,
    help="Maximum polling attempts.",
)
@click.option(
    "--allow-timeout",
    is_flag=True,
    help="Return success payload on timeout instead of non-zero exit.",
)
@click.pass_context
def runs_wait(
    ctx: click.Context,
    run_id_or_task_name: str,
    interval: float,
    attempts: int,
    allow_timeout: bool,
) -> None:
    """Poll one run until terminal status. Prefer task_name; numeric input is treated as run_id."""
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    run_id = resolve_run_id_or_task_name(client, run_id_or_task_name, fmt)

    last_payload: dict[str, Any] | None = None
    for attempt in range(1, attempts + 1):
        payload = client.invoke("get_task_instance_detail", {"task_instance_id": run_id}).payload
        _ensure_success(payload, fmt)
        last_payload = payload
        status_code, end_time, fail_msg = _extract_run_status(payload)
        is_terminal = status_code in {1, 3} or (status_code is None and end_time is not None)

        if is_terminal:
            polling = {
                "run_id": run_id,
                "attempts_used": attempt,
                "attempts_max": attempts,
                "interval_seconds": interval,
                "terminal_status": _RUN_STATUS_NAME_BY_CODE.get(status_code, status_code),
            }
            if status_code == 3 or fail_msg:
                log_operation("runs wait", ok=False, error_code="RUN_FAILED")
                output.error(
                    "RUN_FAILED",
                    str(fail_msg or f"Run {run_id} ended with terminal failure status"),
                    fmt=fmt,
                    extra={"run_detail": payload, "polling": polling},
                )
            log_operation("runs wait", ok=True)
            output.success(payload, fmt=fmt, extra={"polling": polling})

        if attempt < attempts:
            time.sleep(interval)

    log_operation("runs wait", ok=False, error_code="RUN_WAIT_TIMEOUT")
    timeout_payload = {
        "run_id": run_id,
        "attempts_used": attempts,
        "attempts_max": attempts,
        "interval_seconds": interval,
        "last_detail": last_payload,
    }
    if allow_timeout:
        output.success(timeout_payload, fmt=fmt, ai_message="Polling reached max attempts before terminal state.")
    output.error(
        "RUN_WAIT_TIMEOUT",
        f"Run {run_id} did not reach terminal state within {attempts} attempts.",
        fmt=fmt,
        extra=timeout_payload,
    )


@runs_cmd.command("log")
@click.argument("run_id_or_task_name", type=str)
@click.option("--offset", type=int, help="Read log from byte offset in downward direction.")
@click.pass_context
def runs_log(ctx: click.Context, run_id_or_task_name: str, offset: int | None) -> None:
    """Get run log by run_id or task_name. Prefer task_name; numeric input is treated as run_id."""
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    run_id = resolve_run_id_or_task_name(client, run_id_or_task_name, fmt)
    exec_payload = client.invoke(
        "list_executions", {"task_run_id": run_id, "page_index": 1, "page_size": 20}
    ).payload
    _ensure_success(exec_payload, fmt)
    executions = exec_payload.get("executions", [])
    if not executions:
        output.error("NO_EXECUTIONS", f"Run {run_id} has no execution records yet", fmt=fmt)
    execution_id = int(executions[0].get("execution_id"))

    args: dict[str, Any] = {"task_run_id": run_id, "execution_id": execution_id}
    if offset is not None:
        args["query_action"] = 1
        args["offset"] = offset
    payload = client.invoke("get_execution_log", args).payload
    _ensure_success(payload, fmt)
    normalized_payload = normalize_run_identity(payload, {"execution_id": execution_id}, fallback_run_id=run_id)
    log_operation("runs log", ok=True)
    output.success(normalized_payload, fmt=fmt)


@runs_cmd.command("stop")
@click.argument("run_id_or_task_name", type=str)
@click.option("-y", "yes", is_flag=True, help="Skip confirmation and execute directly.")
@click.pass_context
def runs_stop(ctx: click.Context, run_id_or_task_name: str, yes: bool) -> None:
    """Stop a run by run_id or task_name. Prefer task_name; numeric input is treated as run_id."""
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    run_id = resolve_run_id_or_task_name(client, run_id_or_task_name, fmt)
    if not yes and not click.confirm(f"确认停止运行实例 {run_id} 吗？", err=True):
        output.success(
            {
                "message": "Cancelled by user. No stop action was executed.",
                "action": "runs.stop",
                "executed": False,
            },
            fmt=fmt,
        )
        return
    payload = client.invoke("kill_task_instance", {"task_instance_id": run_id}).payload
    _ensure_success(payload, fmt)
    normalized_payload = normalize_run_identity(payload, fallback_run_id=run_id)
    log_operation("runs stop", ok=True)
    output.success(normalized_payload, fmt=fmt)


@runs_cmd.command("stats", help="Summarize run statistics (count by status/type) for the given time window.")
@click.option("--task", "task_name", help="Task name pattern.")
@click.option("--from", "from_time", help="Start time (ISO format).")
@click.option("--to", "to_time", help="End time (ISO format).")
@click.pass_context
def runs_stats(
    ctx: click.Context, task_name: str | None, from_time: str | None, to_time: str | None
) -> None:
    fmt = ctx.obj.get("format", "json")
    now = datetime.now()
    left_ms = _parse_datetime_to_ms(from_time, now - timedelta(days=1))
    right_ms = _parse_datetime_to_ms(to_time, now)
    args: dict[str, Any] = {
        "query_plan_time_left": left_ms,
        "query_plan_time_right": right_ms,
    }
    if task_name:
        args["task_name_rlike"] = task_name
    payload = _new_client(ctx).invoke("get_task_run_stats", args).payload
    _ensure_success(payload, fmt)
    log_operation("runs stats", ok=True)
    output.success(payload, fmt=fmt)


@runs_cmd.command("refill", help="[🟠 HIGH IMPACT] Submit a backfill job to re-run a task over a historical business time window. Requires user confirmation. Do NOT call this automatically — always confirm the target time window with the user first.")
@click.argument("task_name_or_id", type=str)
@click.option(
    "--from", "from_time", help="Backfill business start time (YYYY-MM-DD or ISO datetime)."
)
@click.option("--to", "to_time", help="Backfill business end time (YYYY-MM-DD or ISO datetime).")
@click.option(
    "--vc",
    "sql_vc_code",
    default="DEFAULT",
    show_default=True,
    help="VC code used for complement job.",
)
@click.option(
    "--name", "job_name", help="Optional complement job name. Auto-generated when omitted."
)
@click.option("-y", "yes", is_flag=True, help="Skip confirmation and execute directly.")
@click.pass_context
def runs_refill(
    ctx: click.Context,
    task_name_or_id: str,
    from_time: str | None,
    to_time: str | None,
    sql_vc_code: str,
    job_name: str | None,
    yes: bool,
) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    task_id = resolve_task_id(client, task_name_or_id, fmt)
    if not yes and not click.confirm(f"确认为任务 {task_id} 提交补数任务吗？", err=True):
        output.success(
            {
                "message": "Cancelled by user. No refill action was executed.",
                "action": "runs.refill",
                "executed": False,
            },
            fmt=fmt,
        )
        return

    args: dict[str, Any] = {
        "schedule_task_id": task_id,
        "sql_vc_code": sql_vc_code,
    }
    if from_time and to_time:
        args["biz_start_time"] = _parse_window_boundary_to_ms(from_time, end_of_day=False)
        args["biz_end_time"] = _parse_window_boundary_to_ms(to_time, end_of_day=True)
    elif not from_time and not to_time:
        # Default behavior: submit one immediate backfill window.
        now_ms = int(datetime.now().timestamp() * 1000)
        args["biz_start_time"] = now_ms
        args["biz_end_time"] = now_ms
    else:
        output.error(
            "INVALID_ARGUMENTS",
            "--from and --to must be provided together, or omit both to run one immediate backfill.",
            fmt=fmt,
            exit_code=output.EXIT_USAGE_ERROR,
        )
    if job_name:
        args["complement_job_name"] = job_name
    payload = client.invoke("create_backfill_job", args).payload
    _ensure_success(payload, fmt)
    normalized_payload = normalize_run_identity(payload)
    ai_message = None
    if normalized_payload.get("run_id") is not None and payload.get("backfill_task_id") is not None:
        ai_message = (
            f"补数任务已提交（run_id={normalized_payload.get('run_id')}）。"
            "已归一化: backfill_task_id 即本次补数运行实例 run_id。"
            "可使用 `cz-cli runs log <run_id>` 查看执行日志，"
            "或使用 `cz-cli runs detail <run_id>` 查看状态。"
        )
    log_operation("runs refill", ok=True)
    output.success(normalized_payload, fmt=fmt, ai_message=ai_message)
