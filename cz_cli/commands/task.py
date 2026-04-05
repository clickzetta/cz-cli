"""Studio task and flow commands."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import click

from cz_cli import output
from cz_cli.cli_group import CLIGroup
from cz_cli.logger import log_operation
from cz_cli.studio_identity import normalize_run_identity, normalize_task_identity
from cz_cli.studio_resolver import ensure_tool_success, resolve_task_id as resolve_task_id_or_name
from cz_cli.studio_client import StudioClient, configure_mcp_logging, studio_connection_kwargs

_TASK_TYPE_MAP = {
    "SQL": 23,
    "PYTHON": 26,
    "SHELL": 24,
    "SPARK": 400,
    "FLOW": 500,
}

_OFFLINE_CONFIRM_MESSAGE = """请注意，仅当周期性任务不存在下游任务依赖时，方可将其下线。若需同时下线某一任务及其所有下游任务，请使用“下线（含下游）”操作。下线周期性任务时，该任务对应的所有实例，包括已运行的历史实例和未运行的实例，都将被清除，且此清理操作不可恢复。任务重新上线后，将生成上线时间之后的新实例。您是否确定要下线此任务？"""


def _new_client(ctx: click.Context) -> StudioClient:
    configure_mcp_logging("DEBUG" if ctx.obj.get("debug") else None)
    return StudioClient(
        profile=ctx.obj.get("profile"),
        jdbc_url=ctx.obj.get("jdbc_url"),
        **studio_connection_kwargs(ctx.obj),
    )


def _ensure_success(payload: dict[str, Any], fmt: str) -> None:
    ensure_tool_success(payload, fmt)


def _parse_task_type(value: str | None) -> int | None:
    if value is None:
        return None
    upper = value.upper()
    if upper in _TASK_TYPE_MAP:
        return _TASK_TYPE_MAP[upper]
    try:
        return int(value)
    except ValueError:
        raise click.BadParameter(
            f"Unsupported task type: {value}. Use SQL/PYTHON/SHELL/SPARK/FLOW or integer code."
        )


def _resolve_folder_id_by_name(client: "StudioClient", name: str, fmt: str) -> int:
    """Resolve a folder name to its integer ID by searching all pages."""
    page = 1
    while True:
        result = client.invoke("list_folders", {"parentFolderId": 0, "page": page, "pageSize": 50})
        payload = result.payload
        _ensure_success(payload, fmt)
        folders = payload.get("folders", [])
        for f in folders:
            if f.get("dataFolderName") == name:
                return int(f["id"])
        pagination = payload.get("pagination", {})
        if page >= pagination.get("totalPages", 1):
            break
        page += 1
    output.error(
        "FOLDER_NOT_FOUND",
        f"No folder named '{name}' was found. Use `cz-cli task folders` to list available folders.",
        fmt=fmt,
        exit_code=output.EXIT_USAGE_ERROR,
    )


def _normalize_cron_expression(value: str) -> str:
    parts = value.split()
    if len(parts) == 5:
        return "0 " + " ".join(parts)
    if len(parts) == 6:
        return " ".join(parts)
    raise ValueError("Cron expression must have 5 or 6 fields.")


def _online_reminder(task_id: int) -> str:
    return (
        f"草稿已保存（task_id={task_id}）。"
        "注意：调度尚未激活。"
        "请在用户明确要求发布后，再执行: "
        f"cz-cli task online {task_id} -y"
    )


def _parse_key_value_pairs(values: tuple[str, ...], fmt: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for item in values:
        if "=" not in item:
            output.error(
                "INVALID_ARGUMENTS",
                f"Invalid --param value '{item}': expected KEY=VALUE.",
                fmt=fmt,
                exit_code=output.EXIT_USAGE_ERROR,
            )
        key, value = item.split("=", 1)
        key = key.strip()
        if not key:
            output.error(
                "INVALID_ARGUMENTS",
                "Invalid --param value: KEY cannot be empty.",
                fmt=fmt,
                exit_code=output.EXIT_USAGE_ERROR,
            )
        parsed[key] = value
    return parsed


@click.group("task", cls=CLIGroup)
@click.pass_context
def task_cmd(ctx: click.Context) -> None:
    """Manage Studio schedule tasks and flow tasks."""


@task_cmd.command("folders", help="List Studio task folders. Supports pagination via --page and --page-size.")
@click.option(
    "--parent", "parent_folder_id", type=int, default=0, show_default=True, help="Parent folder ID."
)
@click.option("--page", type=int, default=1, show_default=True, help="Page index.")
@click.option(
    "--page-size", "page_size", type=int, default=10, show_default=True, help="Page size."
)
@click.pass_context
def task_folders(ctx: click.Context, parent_folder_id: int, page: int, page_size: int) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    result = client.invoke(
        "list_folders",
        {
            "parentFolderId": parent_folder_id,
            "page": page,
            "pageSize": page_size,
        },
    )
    payload = result.payload
    _ensure_success(payload, fmt)
    items = payload.get("folders", [])
    pagination = payload.get("pagination", {})
    ai_message = (
        f"当前仅展示第 {pagination.get('page', page)} 页。可使用 --page 和 --page-size 翻页。"
    )
    log_operation("task folders", ok=True)
    output.success(items, fmt=fmt, ai_message=ai_message, extra={"pagination": pagination})


@task_cmd.command("create-folder", help="Create a new task folder. Use --parent to nest inside an existing folder (default: root).")
@click.argument("folder_name", type=str)
@click.option(
    "--parent", "parent_folder_id", type=int, default=0, show_default=True, help="Parent folder ID."
)
@click.pass_context
def task_create_folder(ctx: click.Context, folder_name: str, parent_folder_id: int) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    payload = client.invoke(
        "create_folder",
        {
            "data_folder_name": folder_name,
            "parent_folder_id": parent_folder_id,
        },
    ).payload
    _ensure_success(payload, fmt)
    log_operation("task create-folder", ok=True)
    output.success(payload, fmt=fmt)


@task_cmd.command(
    "create",
    help=(
        "Create a new Studio task (draft). `--type` is required "
        "(SQL/PYTHON/SHELL/SPARK/FLOW). Follow up with `task save` to add content, "
        "then `task save-config` for schedule, then `task online` to activate."
    ),
)
@click.argument("task_name", type=str)
@click.option(
    "--type",
    "task_type",
    required=True,
    help="Task type (SQL/PYTHON/SHELL/SPARK/FLOW or integer code).",
)
@click.option(
    "--folder",
    "--folder-id",
    "folder",
    type=str,
    default="0",
    show_default=True,
    help="Target folder ID (integer) or folder name (string). If a name is given, it will be resolved to an ID automatically.",
)
@click.option("--description", "task_description", help="Task description.")
@click.pass_context
def task_create(
    ctx: click.Context,
    task_name: str,
    task_type: str,
    folder: str,
    task_description: str | None,
) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    parsed_type = _parse_task_type(task_type)
    # Resolve folder: accept either an integer ID or a folder name string
    if folder.lstrip("-").isdigit():
        folder_id = int(folder)
    else:
        folder_id = _resolve_folder_id_by_name(client, folder, fmt)
    args: dict[str, Any] = {
        "task_type": parsed_type,
        "task_name": task_name,
        "data_folder_id": folder_id,
    }
    if task_description:
        args["task_description"] = task_description
    payload = client.invoke("create_task", args).payload
    _ensure_success(payload, fmt)
    log_operation("task create", ok=True)
    output.success(payload, fmt=fmt)


@task_cmd.command("list", help="List tasks in the current workspace. Supports pagination and filters. Returns page 1 only by default — check ai_message for total count.")
@click.option("--folder", "--folder-id", "folder_id", type=int, help="Folder ID filter.")
@click.option(
    "--type", "task_type", help="Task type (SQL/PYTHON/SHELL/SPARK/FLOW or integer code)."
)
@click.option("--name", "task_name", help="Task name fuzzy filter.")
@click.option("--page", type=int, default=1, show_default=True, help="Page index.")
@click.option(
    "--page-size", "page_size", type=int, default=10, show_default=True, help="Page size."
)
@click.option("--limit", type=click.IntRange(min=1), help="Alias of --page-size.")
@click.pass_context
def task_list(
    ctx: click.Context,
    folder_id: int | None,
    task_type: str | None,
    task_name: str | None,
    page: int,
    page_size: int,
    limit: int | None,
) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    if limit is not None:
        page_size = int(limit)
    args: dict[str, Any] = {"page": page, "pageSize": page_size}
    if folder_id is not None:
        args["folderId"] = folder_id
    if task_name:
        args["taskName"] = task_name
    parsed_type = _parse_task_type(task_type)
    if parsed_type is not None:
        args["taskType"] = parsed_type

    result = client.invoke("list_clickzetta_tasks", args)
    payload = result.payload
    _ensure_success(payload, fmt)

    tasks = payload.get("tasks", [])
    pagination = payload.get("pagination", {})
    total = pagination.get("total")
    ai_message = (
        f"当前仅展示第 {pagination.get('page', page)} 页"
        + (f"（{len(tasks)} 条 / 共 {total} 条）" if total is not None else "")
        + f"。如需下一页，请执行: cz-cli task list --page {page + 1} --page-size {page_size}"
    )
    log_operation("task list", ok=True)
    output.success(tasks, fmt=fmt, ai_message=ai_message, extra={"pagination": pagination})


@task_cmd.command("detail", help="Show full task detail including content, config, and online status.")
@click.argument("task_name_or_id", type=str)
@click.pass_context
def task_detail(ctx: click.Context, task_name_or_id: str) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    payload = client.invoke("get_task_detail", {"task_id": task_id}).payload
    _ensure_success(payload, fmt)
    normalized = normalize_task_identity(payload.get("task_detail", payload), fallback_task_id=task_id)
    log_operation("task detail", ok=True)
    output.success(normalized, fmt=fmt)


@task_cmd.command("save", help="Save task script content as a draft. Does NOT activate the schedule — run `task online` separately when ready to publish.")
@click.argument("task_name_or_id", type=str)
@click.option(
    "--content",
    help="Task content text. For multiline scripts (especially Python), prefer -f/--file.",
)
@click.option(
    "-f",
    "--file",
    "file_path",
    type=click.Path(exists=True),
    help="Task content file path (recommended for SQL/Shell/Python scripts).",
)
@click.pass_context
def task_save(
    ctx: click.Context, task_name_or_id: str, content: str | None, file_path: str | None
) -> None:
    fmt = ctx.obj.get("format", "json")
    if bool(content) == bool(file_path):
        output.error(
            "INVALID_ARGUMENTS",
            "Exactly one of --content or --file is required.",
            fmt=fmt,
            exit_code=output.EXIT_USAGE_ERROR,
        )
    client = _new_client(ctx)
    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    text = content if content is not None else Path(file_path).read_text(encoding="utf-8")
    payload = client.invoke(
        "save_non_integration_task_content",
        # replace_escaped_chars=False: both --file and --content supply literal text
        # where \n is already a real newline (or a two-char escape that must stay as-is).
        # The default True is only correct when an AI model passes JSON-escaped content
        # directly via MCP; the CLI always receives the file/string as-is.
        {"task_id": task_id, "task_content": text, "param_value_list": [], "replace_escaped_chars": False},
    ).payload
    _ensure_success(payload, fmt)
    normalized_payload = normalize_task_identity(payload, fallback_task_id=task_id)
    log_operation("task save", ok=True)
    output.success(normalized_payload, fmt=fmt, ai_message=_online_reminder(task_id))


@task_cmd.command("save-config", help="Save schedule configuration (cron, VC, schema) as a draft. Does NOT activate the schedule — run `task online` separately when ready to publish.")
@click.argument("task_name_or_id", type=str)
@click.option(
    "--cron",
    "cron_expr",
    required=True,
    help="Cron expression. 5-field expressions are accepted and auto-converted to 6 fields.",
)
@click.option("--vc", "vc_name", help="Virtual cluster code.")
@click.option("--schema", "schema_name", help="Schema name.")
@click.pass_context
def task_save_config(
    ctx: click.Context,
    task_name_or_id: str,
    cron_expr: str,
    vc_name: str | None,
    schema_name: str | None,
) -> None:
    fmt = ctx.obj.get("format", "json")
    try:
        normalized_cron = _normalize_cron_expression(cron_expr)
    except ValueError:
        output.error(
            "INVALID_ARGUMENTS",
            "Invalid --cron value: expected 5 or 6 fields.",
            fmt=fmt,
            exit_code=output.EXIT_USAGE_ERROR,
        )
    client = _new_client(ctx)
    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    args: dict[str, Any] = {"task_id": task_id, "cron_express": normalized_cron}
    if vc_name:
        args["etl_vc_code"] = vc_name
    if schema_name:
        args["schema_name"] = schema_name
    tool_name = (
        "save_task_cron_configuration"
        if client.has_tool("save_task_cron_configuration")
        else "save_task_configuration"
    )
    if tool_name == "save_task_configuration":
        # Backward compatibility for older MCP toolsets lacking cron-only save tool.
        args.setdefault("rerun_property", 1)
    payload = client.invoke(tool_name, args).payload
    _ensure_success(payload, fmt)
    normalized_payload = normalize_task_identity(payload, fallback_task_id=task_id)
    log_operation("task save-config", ok=True)
    output.success(normalized_payload, fmt=fmt, ai_message=_online_reminder(task_id))


@task_cmd.command("execute", help="[Notice: SIDE EFFECT] Run one temporary execution immediately without publishing to schedule. AI agents MUST obtain explicit user approval before calling this command. There is NO -y flag — approval is obtained by asking the user, not via a CLI option. Use for ad-hoc or validation runs only.")
@click.argument("task_name_or_id", type=str)
@click.option(
    "--content",
    help="Temporary execution content override. If omitted, use task detail content.",
)
@click.option(
    "-f",
    "--file",
    "file_path",
    type=click.Path(exists=True),
    help="Read temporary execution content from file.",
)
@click.option("--vc", "vc_name", help="Temporary execution VC code.")
@click.option("--schema", "schema_name", help="Temporary execution schema name.")
@click.option("--param", "params", multiple=True, help="Execution parameter KEY=VALUE.")
@click.option(
    "--max-wait-seconds",
    type=click.IntRange(min=1),
    default=300,
    show_default=True,
    help="Maximum seconds to wait for temporary execution completion.",
)
@click.option(
    "--poll-interval",
    type=click.IntRange(min=1),
    default=5,
    show_default=True,
    help="Polling interval (seconds) for temporary execution.",
)
@click.pass_context
def task_execute(
    ctx: click.Context,
    task_name_or_id: str,
    content: str | None,
    file_path: str | None,
    vc_name: str | None,
    schema_name: str | None,
    params: tuple[str, ...],
    max_wait_seconds: int,
    poll_interval: int,
) -> None:
    """Execute one temporary run immediately without online."""
    fmt = ctx.obj.get("format", "json")
    if content and file_path:
        output.error(
            "INVALID_ARGUMENTS",
            "Use at most one of --content or --file.",
            fmt=fmt,
            exit_code=output.EXIT_USAGE_ERROR,
        )

    client = _new_client(ctx)
    if not client.has_tool("execute_task"):
        output.error(
            "INVALID_ARGUMENTS",
            "Current MCP toolset does not support temporary execution tool 'execute_task'.",
            fmt=fmt,
            exit_code=output.EXIT_USAGE_ERROR,
        )

    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    detail_payload = client.invoke("get_task_detail", {"task_id": task_id}).payload
    _ensure_success(detail_payload, fmt)
    task_detail = detail_payload.get("task_detail", {})

    text = content
    if file_path:
        text = Path(file_path).read_text(encoding="utf-8")
    if text is None:
        text = task_detail.get("task_content")
    if not isinstance(text, str) or not text.strip():
        output.error(
            "INVALID_ARGUMENTS",
            "Task content is empty. Provide --content/--file or ensure task detail contains task_content.",
            fmt=fmt,
            exit_code=output.EXIT_USAGE_ERROR,
        )

    resolved_vc = vc_name or task_detail.get("default_vc_name") or ctx.obj.get("vcluster")
    if not resolved_vc:
        output.error(
            "INVALID_ARGUMENTS",
            "Temporary execution requires VC. Provide --vc or set task/profile default VC.",
            fmt=fmt,
            exit_code=output.EXIT_USAGE_ERROR,
        )
    resolved_schema = schema_name or task_detail.get("default_schema_name") or ctx.obj.get("schema")

    args: dict[str, Any] = {
        "data_task_id": task_id,
        "data_task_content": text,
        "adhoc_vc_code": resolved_vc,
        "max_wait_seconds": max_wait_seconds,
        "poll_interval": poll_interval,
    }
    if resolved_schema:
        args["adhoc_schema_name"] = resolved_schema
    if params:
        args["params"] = _parse_key_value_pairs(params, fmt)

    payload = client.invoke("execute_task", args).payload
    _ensure_success(payload, fmt)

    normalized = normalize_run_identity(payload, payload.get("task_detail"), fallback_run_id=payload.get("task_instance_id"))
    normalized = normalize_task_identity(normalized, task_detail, fallback_task_id=task_id)
    ai_message = (
        f"临时执行完成（task_id={normalized.get('task_id')}，run_id={normalized.get('run_id')}）。"
        "Notice: 这是一次临时执行，不影响调度计划。"
        "如需将当前脚本提升为正式调度，请在用户确认后执行: "
        f"cz-cli task online {normalized.get('task_id')} -y"
        if normalized.get("run_id") is not None
        else f"临时执行完成（task_id={normalized.get('task_id')}）。Notice: 这是一次临时执行，不影响调度计划。"
    )
    log_operation("task execute", ok=True)
    output.success(normalized, fmt=fmt, ai_message=ai_message)


@task_cmd.command("online", help="[🟠 HIGH IMPACT] Publish a task draft to activate scheduling. Non-Flow tasks only. Requires user confirmation. Do NOT call this automatically after save — wait for explicit user instruction.")
@click.argument("task_name_or_id", type=str)
@click.option(
    "--version", type=int, help="Task version. If omitted, use current version from task detail."
)
@click.option("-y", "yes", is_flag=True, help="Skip confirmation and execute directly.")
@click.pass_context
def task_online(ctx: click.Context, task_name_or_id: str, version: int | None, yes: bool) -> None:
    """Online a schedule task for execution (non-Flow tasks only)."""
    _task_online_common(ctx, task_name_or_id, version, yes)


def _task_online_common(
    ctx: click.Context,
    task_name_or_id: str,
    version: int | None,
    yes: bool,
) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    if not yes and not click.confirm(f"确认上线任务 {task_id} 吗？", err=True):
        output.success(
            {
                "message": "Cancelled by user. No online action was executed.",
                "action": "task.online",
                "executed": False,
            },
            fmt=fmt,
        )
        return

    detail = client.invoke("get_task_detail", {"task_id": task_id}).payload
    _ensure_success(detail, fmt)
    task_detail = detail.get("task_detail", {})
    task_type = task_detail.get("task_type")
    if task_type == _TASK_TYPE_MAP["FLOW"]:
        output.error(
            "INVALID_ARGUMENTS",
            "Flow tasks cannot be online with task online. Use: cz-cli task flow submit TASK_NAME_OR_ID",
            fmt=fmt,
            exit_code=output.EXIT_USAGE_ERROR,
        )

    resolved_version = version if version is not None else task_detail.get("current_version")
    if resolved_version is None:
        output.error("INVALID_ARGUMENTS", "Unable to derive task version from task detail.", fmt=fmt)
    payload = client.invoke(
        "publish_task", {"task_id": task_id, "task_version": resolved_version}
    ).payload
    _ensure_success(payload, fmt)
    log_operation("task online", ok=True)
    output.success(payload, fmt=fmt)


@task_cmd.command("offline", help="[🔴 IRREVERSIBLE] Take a task offline and clear ALL run instances (past and future). This CANNOT be undone. All historical instance records are permanently deleted. The task must have no active downstream dependencies. Requires explicit user confirmation.")
@click.argument("task_name_or_id", type=str)
@click.option("--with-downstream", is_flag=True, help="Offline task with all downstream tasks.")
@click.option("-y", "yes", is_flag=True, help="Skip confirmation and execute directly.")
@click.pass_context
def task_offline(
    ctx: click.Context, task_name_or_id: str, with_downstream: bool, yes: bool
) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    if not yes and not click.confirm(_OFFLINE_CONFIRM_MESSAGE, err=True):
        output.success(
            {
                "message": "Cancelled by user. No offline action was executed.",
                "action": "task.offline",
                "executed": False,
            },
            fmt=fmt,
        )
        return

    tool_name = "offline_task_with_downstream" if with_downstream else "offline_task"
    args: dict[str, Any] = {"schedule_task_id": task_id}
    if with_downstream:
        args["tasks"] = []
    payload = client.invoke(tool_name, args).payload
    _ensure_success(payload, fmt)
    log_operation("task offline", ok=True)
    output.success(payload, fmt=fmt)


@task_cmd.group("flow", cls=CLIGroup)
@click.pass_context
def task_flow(ctx: click.Context) -> None:
    """Manage Flow task nodes and dependencies."""


@task_flow.command("dag")
@click.argument("task_name_or_id", type=str)
@click.pass_context
def flow_dag(ctx: click.Context, task_name_or_id: str) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    payload = client.invoke("get_flow_dag", {"task_id": task_id}).payload
    _ensure_success(payload, fmt)
    output.success(payload, fmt=fmt)


@task_flow.command("create-node")
@click.argument("task_name_or_id", type=str)
@click.option("--name", "node_name", required=True, help="Node name.")
@click.option("--type", "node_type", default="sql", show_default=True, help="Node type.")
@click.option("--description", "node_description", help="Node description.")
@click.option("--dependency", "dependency_node_name", help="Dependency node name.")
@click.option("--content", help="Initial node content.")
@click.pass_context
def flow_create_node(
    ctx: click.Context,
    task_name_or_id: str,
    node_name: str,
    node_type: str,
    node_description: str | None,
    dependency_node_name: str | None,
    content: str | None,
) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    args: dict[str, Any] = {"task_id": task_id, "node_name": node_name, "node_type": node_type}
    if node_description:
        args["node_description"] = node_description
    if dependency_node_name:
        args["dependency_node_name"] = dependency_node_name
    if content:
        args["content"] = content
    payload = client.invoke("create_flow_node", args).payload
    _ensure_success(payload, fmt)
    output.success(payload, fmt=fmt)


@task_flow.command("remove-node")
@click.argument("task_name_or_id", type=str)
@click.option("--name", "node_name", required=True, help="Node name.")
@click.pass_context
def flow_remove_node(ctx: click.Context, task_name_or_id: str, node_name: str) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    payload = client.invoke(
        "remove_flow_node", {"task_id": task_id, "node_name": node_name}
    ).payload
    _ensure_success(payload, fmt)
    output.success(payload, fmt=fmt)


@task_flow.command("bind")
@click.argument("task_name_or_id", type=str)
@click.option("--upstream", "upstream_node_name", required=True, help="Upstream node name.")
@click.option("--downstream", "downstream_node_name", required=True, help="Downstream node name.")
@click.pass_context
def flow_bind(
    ctx: click.Context, task_name_or_id: str, upstream_node_name: str, downstream_node_name: str
) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    payload = client.invoke(
        "bind_flow_node",
        {
            "task_id": task_id,
            "upstream_node_name": upstream_node_name,
            "downstream_node_name": downstream_node_name,
        },
    ).payload
    _ensure_success(payload, fmt)
    output.success(payload, fmt=fmt)


@task_flow.command("unbind")
@click.argument("task_name_or_id", type=str)
@click.option("--dependency-id", type=int, required=True, help="Dependency ID.")
@click.pass_context
def flow_unbind(ctx: click.Context, task_name_or_id: str, dependency_id: int) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    payload = client.invoke(
        "unbind_flow_node", {"task_id": task_id, "dependency_id": dependency_id}
    ).payload
    _ensure_success(payload, fmt)
    output.success(payload, fmt=fmt)


def _resolve_node_id_for_cmd(
    client: StudioClient, task_id: int, node_id: int | None, node_name: str | None
) -> int:
    if node_id is not None:
        return node_id
    if not node_name:
        raise ValueError("Either --node or --name is required.")
    return client.resolve_flow_node_id(task_id, node_name)


@task_flow.command("node-detail")
@click.argument("task_name_or_id", type=str)
@click.option("--node", "node_id", type=int, help="Node ID.")
@click.option("--name", "node_name", help="Node name (auto-resolve to node ID).")
@click.pass_context
def flow_node_detail(
    ctx: click.Context, task_name_or_id: str, node_id: int | None, node_name: str | None
) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    resolved = _resolve_node_id_for_cmd(client, task_id, node_id, node_name)
    payload = client.invoke(
        "get_flow_node_detail", {"task_id": task_id, "node_id": resolved}
    ).payload
    _ensure_success(payload, fmt)
    output.success(payload, fmt=fmt)


@task_flow.command("node-save")
@click.argument("task_name_or_id", type=str)
@click.option("--node", "node_id", type=int, help="Node ID.")
@click.option("--name", "node_name", help="Node name (auto-resolve to node ID).")
@click.option("--content", required=True, help="Node content.")
@click.pass_context
def flow_node_save(
    ctx: click.Context,
    task_name_or_id: str,
    node_id: int | None,
    node_name: str | None,
    content: str,
) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    resolved = _resolve_node_id_for_cmd(client, task_id, node_id, node_name)
    payload = client.invoke(
        "save_node_content", {"task_id": task_id, "node_id": resolved, "content": content}
    ).payload
    _ensure_success(payload, fmt)
    output.success(payload, fmt=fmt)


@task_flow.command("node-save-config")
@click.argument("task_name_or_id", type=str)
@click.option("--node", "node_id", type=int, help="Node ID.")
@click.option("--name", "node_name", help="Node name (auto-resolve to node ID).")
@click.option("--schema", "schema_name", help="Schema name.")
@click.option("--vc", "etl_vc_code", help="Virtual cluster code.")
@click.pass_context
def flow_node_save_config(
    ctx: click.Context,
    task_name_or_id: str,
    node_id: int | None,
    node_name: str | None,
    schema_name: str | None,
    etl_vc_code: str | None,
) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    resolved = _resolve_node_id_for_cmd(client, task_id, node_id, node_name)
    args: dict[str, Any] = {"task_id": task_id, "node_id": resolved}
    if schema_name:
        args["schema_name"] = schema_name
    if etl_vc_code:
        args["etl_vc_code"] = etl_vc_code
    payload = client.invoke("save_node_configuration", args).payload
    _ensure_success(payload, fmt)
    output.success(payload, fmt=fmt)


@task_flow.command("submit")
@click.argument("task_name_or_id", type=str)
@click.pass_context
def flow_submit(ctx: click.Context, task_name_or_id: str) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    task_id = resolve_task_id_or_name(client, task_name_or_id, fmt)
    payload = client.invoke("submit_flow", {"task_id": task_id}).payload
    _ensure_success(payload, fmt)
    output.success(payload, fmt=fmt)


@task_flow.command("instances")
@click.option("--flow", "flow_name_or_id", type=str, required=True, help="Flow task ID or name.")
@click.option("--instance", "flow_instance_id", type=int, required=True, help="Flow instance ID.")
@click.option("--node-id", type=int, help="Flow node ID.")
@click.option("--node-instance-id", type=int, help="Flow node instance ID.")
@click.pass_context
def flow_instances(
    ctx: click.Context,
    flow_name_or_id: str,
    flow_instance_id: int,
    node_id: int | None,
    node_instance_id: int | None,
) -> None:
    fmt = ctx.obj.get("format", "json")
    client = _new_client(ctx)
    flow_id = resolve_task_id_or_name(client, flow_name_or_id, fmt)
    args: dict[str, Any] = {"flow_id": flow_id, "flow_instance_id": flow_instance_id}
    if node_id is not None:
        args["flow_node_id"] = node_id
    if node_instance_id is not None:
        args["flow_node_instance_id"] = node_instance_id
    payload = client.invoke("list_flow_node_instances", args).payload
    _ensure_success(payload, fmt)
    output.success(payload, fmt=fmt)
