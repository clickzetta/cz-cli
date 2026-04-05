"""Studio execution record commands."""

from __future__ import annotations

from typing import Any

import click

from cz_cli import output
from cz_cli.cli_group import CLIGroup
from cz_cli.logger import log_operation
from cz_cli.studio_identity import normalize_run_identity
from cz_cli.studio_resolver import (
    ensure_tool_success,
    resolve_latest_run_id,
    resolve_run_id_or_task_name,
)
from cz_cli.studio_client import StudioClient, configure_mcp_logging, studio_connection_kwargs


def _new_client(ctx: click.Context) -> StudioClient:
    configure_mcp_logging("DEBUG" if ctx.obj.get("debug") else None)
    return StudioClient(
        profile=ctx.obj.get("profile"),
        jdbc_url=ctx.obj.get("jdbc_url"),
        **studio_connection_kwargs(ctx.obj),
    )


def _ensure_success(payload: dict[str, Any], fmt: str) -> None:
    ensure_tool_success(payload, fmt)


@click.group("executions", cls=CLIGroup)
@click.pass_context
def executions_cmd(ctx: click.Context) -> None:
    """Manage execution records and logs for task runs (run_id first, not execution_id)."""


@executions_cmd.command("list")
@click.argument("run_id_or_task_name", required=False, type=str)
@click.option("--page", type=int, default=1, show_default=True, help="Page index.")
@click.option(
    "--page-size", "page_size", type=int, default=10, show_default=True, help="Page size."
)
@click.option("--limit", type=click.IntRange(min=1), help="Alias of --page-size.")
@click.pass_context
def executions_list(
    ctx: click.Context,
    run_id_or_task_name: str | None,
    page: int,
    page_size: int,
    limit: int | None,
) -> None:
    """List execution records by run_id or task_name. Prefer task_name; numeric input is treated as run_id."""
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    if run_id_or_task_name:
        run_id = resolve_run_id_or_task_name(client, run_id_or_task_name, fmt)
        source_message = f"来源: {run_id_or_task_name}"
    else:
        run_id = resolve_latest_run_id(client, fmt)
        source_message = "未指定 run/task，已自动选择最近一次运行实例"
    if limit is not None:
        page_size = int(limit)
    payload = client.invoke(
        "list_executions", {"task_run_id": run_id, "page_index": page, "page_size": page_size}
    ).payload
    _ensure_success(payload, fmt)
    items = [
        normalize_run_identity(item, {"task_run_id": run_id})
        for item in payload.get("executions", [])
    ]
    total = payload.get("total_count")
    ai_message = (
        f"当前仅展示第 {page} 页"
        + (f"（{len(items)} 条 / 共 {total} 条）" if total is not None else "")
        + f"，{source_message}（run_id={run_id}）"
        + f"。如需下一页，请执行: cz-cli executions list {run_id} --page {page + 1} --page-size {page_size}"
    )
    log_operation("executions list", ok=True)
    output.success(
        items,
        fmt=fmt,
        ai_message=ai_message,
        extra={
            "pagination": {"page": page, "page_size": page_size, "total": total},
            "selected_run_id": run_id,
            "run_id": run_id,
        },
    )


@executions_cmd.command("log")
@click.argument("run_id_or_task_name", type=str)
@click.option(
    "--execution-id",
    type=int,
    help="Optional execution ID override. Positional argument is run_id/task_name, not execution_id.",
)
@click.option("--offset", type=int, help="Read log from byte offset in downward direction.")
@click.pass_context
def executions_log(
    ctx: click.Context,
    run_id_or_task_name: str,
    execution_id: int | None,
    offset: int | None,
) -> None:
    """Get execution log by run_id or task_name. Prefer task_name; numeric input is treated as run_id."""
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    run_id = resolve_run_id_or_task_name(client, run_id_or_task_name, fmt)

    chosen_execution_id = execution_id
    if chosen_execution_id is None:
        exec_payload = client.invoke(
            "list_executions", {"task_run_id": run_id, "page_index": 1, "page_size": 20}
        ).payload
        _ensure_success(exec_payload, fmt)
        executions = exec_payload.get("executions", [])
        if not executions:
            output.error("NO_EXECUTIONS", f"Run {run_id} has no execution records yet", fmt=fmt)
        chosen_execution_id = int(executions[0].get("execution_id"))

    args: dict[str, Any] = {"task_run_id": run_id, "execution_id": int(chosen_execution_id)}
    if offset is not None:
        args["query_action"] = 1
        args["offset"] = offset
    payload = client.invoke("get_execution_log", args).payload
    _ensure_success(payload, fmt)
    normalized_payload = normalize_run_identity(
        payload, {"execution_id": int(chosen_execution_id)}, fallback_run_id=run_id
    )
    log_operation("executions log", ok=True)
    output.success(normalized_payload, fmt=fmt)


@executions_cmd.command("stop")
@click.argument("run_id_or_task_name", type=str)
@click.option("-y", "yes", is_flag=True, help="Skip confirmation and execute directly.")
@click.pass_context
def executions_stop(ctx: click.Context, run_id_or_task_name: str, yes: bool) -> None:
    """Stop execution by run_id or task_name. Prefer task_name; numeric input is treated as run_id."""
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    run_id = resolve_run_id_or_task_name(client, run_id_or_task_name, fmt)
    if not yes and not click.confirm(
        f"确认停止运行实例 {run_id} 吗？（executions stop 会停止该运行实例的执行）",
        err=True,
    ):
        output.success(
            {
                "message": "Cancelled by user. No stop action was executed.",
                "action": "executions.stop",
                "executed": False,
            },
            fmt=fmt,
        )
        return
    payload = client.invoke("kill_task_instance", {"task_instance_id": run_id}).payload
    _ensure_success(payload, fmt)
    normalized_payload = normalize_run_identity(payload, fallback_run_id=run_id)
    log_operation("executions stop", ok=True)
    output.success(normalized_payload, fmt=fmt)
