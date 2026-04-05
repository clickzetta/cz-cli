"""Schema-driven Studio tool invoker for cz-cli task/runs/flow commands."""

from __future__ import annotations

import asyncio
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from types import SimpleNamespace

import yaml
from loguru import logger as _loguru_logger

from cz_cli.connection import ConnectionConfig, resolve_connection_config


def _ensure_local_mcp_repo() -> None:
    env_path = os.environ.get("CZ_MCP_SERVER_PATH", "").strip()
    candidates = []
    if env_path:
        candidates.append(Path(env_path))
    candidates.append(Path(__file__).resolve().parents[2] / "claude-skills-mcp" / "cz-mcp-server")
    for candidate in candidates:
        if candidate.exists() and candidate.is_dir():
            raw = str(candidate)
            if raw not in sys.path:
                sys.path.insert(0, raw)
            break


def configure_mcp_logging(level: str | None = None) -> None:
    """Configure MCP logging for cz-cli invocations."""
    valid_levels = {"TRACE", "DEBUG", "INFO", "SUCCESS", "WARNING", "ERROR", "CRITICAL"}
    selected = (level or os.environ.get("CZ_MCP_LOG_LEVEL", "")).strip().upper()
    if not selected or selected not in valid_levels:
        selected = "WARNING"
    os.environ["CZ_MCP_LOG_LEVEL"] = selected

    _loguru_logger.remove()
    _loguru_logger.add(
        sys.stderr,
        level=selected,
        backtrace=False,
        diagnose=False,
        colorize=sys.stderr.isatty(),
        catch=True,
    )


_ensure_local_mcp_repo()
configure_mcp_logging()

from cz_mcp.handlers.login_server import get_user_id, login_wrapper  # noqa: E402
from cz_mcp.handlers.workspace_server import get_workspace_by_name  # noqa: E402
from cz_mcp.tools import get_all_tools  # noqa: E402
from cz_mcp.transport.argument_normalizer import (  # noqa: E402
    ArgumentNormalizationError,
    create_normalizer_for_tool,
)


def _infer_env(service: str) -> str:
    host = service.replace("https://", "").replace("http://", "")
    if host.startswith("dev-api."):
        return "dev"
    if host.startswith("sit-api."):
        return "sit"
    if host.startswith("uat-api."):
        return "uat"
    if ".api.clickzetta.com" in host:
        return host.split(".api.clickzetta.com")[0]
    if ".api.singdata.com" in host:
        return host.split(".api.singdata.com")[0]
    return "dev"


def _to_service_url(service: str, protocol: str = "https") -> str:
    if service.startswith("https://") or service.startswith("http://"):
        return service
    proto = protocol.lower()
    if proto not in {"http", "https"}:
        proto = "https"
    return f"{proto}://{service}"


def _build_studio_config(cfg: ConnectionConfig) -> SimpleNamespace:
    env = _infer_env(cfg.service)
    service_url = _to_service_url(cfg.service, cfg.protocol)
    if cfg.pat:
        login_data = login_wrapper(instance=cfg.instance, pat=cfg.pat, url=service_url)
    else:
        login_data = login_wrapper(
            instance=cfg.instance,
            username=cfg.username,
            password=cfg.password,
            url=service_url,
        )

    token = login_data.get("token")
    instance_id = int(login_data.get("instance_id") or 0)
    user_id = int(login_data.get("user_id") or 0)
    expire_time = int(login_data.get("expire_time") or 0)

    if not token:
        raise ValueError("AUTH_FAILED: token not found in login response")

    user_json = get_user_id(service_url, token, env=env) or {}
    tenant_id = int(user_json.get("accountId") or 0)
    username = user_json.get("name") or cfg.username or ""
    if not user_id:
        user_id = int(user_json.get("id") or 0)

    workspace_info = get_workspace_by_name(
        user_id=user_id,
        account_id=tenant_id,
        instance_name=cfg.instance,
        workspace_name=cfg.workspace,
        instance_id=instance_id,
        jwt=token,
        env=env,
    )
    if not workspace_info:
        raise ValueError(
            f"WORKSPACE_NOT_FOUND: workspace '{cfg.workspace}' not found for current account/instance"
        )

    workspace_id = int(workspace_info.get("workspaceId") or 0)
    project_id = workspace_info.get("projectId")
    if project_id is None:
        raise ValueError("PROJECT_NOT_FOUND: project_id is missing from workspace info")

    # Keep runtime config as a plain namespace to avoid tight coupling with
    # cz_mcp internal class import graph.
    return SimpleNamespace(
        token=token,
        instance=cfg.instance,
        instance_id=instance_id,
        workspace=cfg.workspace,
        workspace_id=workspace_id,
        vcluster=cfg.vcluster or "default",
        schema=cfg.schema or "public",
        service=cfg.service,
        env=env,
        base_url=service_url,
        project_id=project_id,
        user_id=user_id,
        tenant_id=tenant_id,
        username=username,
        expire_time=expire_time,
    )


@dataclass
class InvokeResult:
    tool_name: str
    arguments: dict[str, Any]
    payload: dict[str, Any]

    @property
    def success(self) -> bool:
        return bool(self.payload.get("success", False))


class StudioClient:
    """Invoke MCP Studio tools with strict inputSchema normalization."""

    def __init__(
        self,
        *,
        profile: str | None = None,
        jdbc_url: str | None = None,
        **kwargs: Any,
    ) -> None:
        cfg = resolve_connection_config(jdbc_url=jdbc_url, profile=profile, **kwargs)
        self.connection = cfg
        self._fake_mode = os.environ.get("CZ_E2E_FAKE_STUDIO", "0") == "1"
        self.studio_config = None if self._fake_mode else _build_studio_config(cfg)

        self._tools = {tool.name: tool for tool in get_all_tools()}
        self._normalizers = {}
        for tool in self._tools.values():
            normalizer = create_normalizer_for_tool(tool)
            if normalizer:
                self._normalizers[tool.name] = normalizer

    def has_tool(self, tool_name: str) -> bool:
        return tool_name in self._tools

    def get_tool_schema(self, tool_name: str) -> dict[str, Any]:
        tool = self._tools.get(tool_name)
        if not tool:
            raise ValueError(f"TOOL_NOT_FOUND: {tool_name}")
        return tool.input_schema

    def invoke(self, tool_name: str, arguments: dict[str, Any] | None = None) -> InvokeResult:
        tool = self._tools.get(tool_name)
        if not tool:
            raise ValueError(f"TOOL_NOT_FOUND: {tool_name}")

        args = arguments or {}
        schema = tool.input_schema or {}
        if schema.get("additionalProperties") is False:
            allowed = set((schema.get("properties") or {}).keys())
            extra = [key for key in args.keys() if key not in allowed]
            if extra:
                raise ValueError(f"INVALID_ARGUMENTS: unknown fields: {', '.join(extra)}")
        normalizer = self._normalizers.get(tool_name)
        try:
            normalized_args = normalizer.normalize(args) if normalizer else args
        except ArgumentNormalizationError as exc:
            detail = exc.details.get("missing_fields")
            msg = f"INVALID_ARGUMENTS: {exc.message}"
            if detail:
                msg = f"INVALID_ARGUMENTS: missing required fields: {', '.join(detail)}"
            raise ValueError(msg) from exc

        if self._fake_mode:
            payload = self._fake_payload(tool_name, normalized_args)
        else:
            result = asyncio.run(
                tool.handler(arguments=normalized_args, studio_config=self.studio_config)
            )
            payload = self._parse_tool_response(result)
        return InvokeResult(tool_name=tool_name, arguments=normalized_args, payload=payload)

    def resolve_flow_node_id(self, task_id: int, node_name: str) -> int:
        dag = self.invoke("get_flow_dag", {"task_id": task_id}).payload
        data = dag.get("data")
        nodes: list[dict[str, Any]] = []
        if isinstance(data, list):
            nodes = data
        elif isinstance(data, dict):
            if isinstance(data.get("nodes"), list):
                nodes = data["nodes"]
        if not nodes and isinstance(dag.get("data"), dict):
            raw_dag = dag["data"].get("data")
            if isinstance(raw_dag, dict) and isinstance(raw_dag.get("nodes"), list):
                nodes = raw_dag["nodes"]
        for node in nodes:
            if str(node.get("fileName")) == node_name:
                return int(node.get("id"))
        raise ValueError(f"NODE_NOT_FOUND: node '{node_name}' not found in flow {task_id}")

    @staticmethod
    def _parse_tool_response(result: list[Any]) -> dict[str, Any]:
        for item in result:
            text = getattr(item, "text", None)
            if not text:
                continue
            parsed = yaml.safe_load(text)
            if not isinstance(parsed, dict):
                continue
            data_list = parsed.get("data")
            if isinstance(data_list, list) and data_list:
                payload = data_list[0]
                if isinstance(payload, dict):
                    return payload
            if isinstance(data_list, dict):
                return data_list
        raise ValueError("TOOL_RESPONSE_PARSE_FAILED: unable to parse tool result payload")

    @staticmethod
    def _fake_payload(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        if tool_name == "list_clickzetta_tasks":
            return {
                "success": True,
                "tasks": [{"task_id": 1, "task_name": "demo_task", "task_type": 23}],
                "pagination": {
                    "page": args.get("page", 1),
                    "pageSize": args.get("pageSize", 10),
                    "total": 1,
                    "totalPages": 1,
                },
            }
        if tool_name == "list_folders":
            return {
                "success": True,
                "folders": [{"folder_id": 1, "folder_name": "root"}],
                "pagination": {
                    "page": args.get("page", 1),
                    "pageSize": args.get("pageSize", 10),
                    "total": 1,
                },
            }
        if tool_name == "get_task_detail":
            return {
                "success": True,
                "task_detail": {"task_id": args.get("task_id"), "current_version": 1},
            }
        if tool_name == "save_non_integration_task_content":
            return {"success": True, "task_id": args.get("task_id")}
        if tool_name == "save_task_configuration":
            return {"success": True, "task_id": args.get("task_id")}
        if tool_name == "publish_task":
            return {"success": True, "task_id": args.get("task_id")}
        if tool_name == "execute_task":
            return {
                "success": True,
                "task_instance_id": 24700001,
                "status_code": 3,
                "execution_status": "SUCCESS",
                "task_detail": {"taskInstanceId": 24700001, "scheduleTaskId": args.get("data_task_id")},
            }
        if tool_name in {"offline_task", "offline_task_with_downstream"}:
            return {"success": True, "schedule_task_id": args.get("schedule_task_id")}
        if tool_name == "list_task_run":
            return {
                "success": True,
                "task_run_list": [{"task_run_id": 1001, "task_name": "demo_task"}],
                "total_count": 1,
                "page_index": args.get("page_index", 1),
            }
        if tool_name == "get_task_instance_detail":
            return {
                "success": True,
                "task_instance_id": args.get("task_instance_id"),
                "status": "FAILED",
            }
        if tool_name == "list_executions":
            return {"success": True, "executions": [{"execution_id": 9001}], "total_count": 1}
        if tool_name == "get_execution_log":
            return {
                "success": True,
                "log_content": "mock log",
                "start_offset": 0,
                "end_offset": 8,
                "has_next": False,
            }
        if tool_name == "kill_task_instance":
            return {"success": True, "task_instance_id": args.get("task_instance_id")}
        if tool_name == "create_backfill_job":
            return {
                "success": True,
                "backfill_task_id": 88001,
                "schedule_task_id": args.get("schedule_task_id"),
                "message": "Backfill job submitted successfully",
            }
        if tool_name == "get_task_run_stats":
            return {"success": True, "statistics": [{"task_run_status": 3, "count": 1}]}
        if tool_name == "get_flow_dag":
            return {
                "success": True,
                "data": {
                    "nodes": [{"id": 11, "fileName": "node_a"}, {"id": 12, "fileName": "node_b"}]
                },
            }
        if tool_name in {
            "create_flow_node",
            "remove_flow_node",
            "bind_flow_node",
            "unbind_flow_node",
            "submit_flow",
            "save_node_content",
            "save_node_configuration",
        }:
            return {"success": True, "data": {"tool": tool_name, "args": args}}
        if tool_name == "get_flow_node_detail":
            return {
                "success": True,
                "data": {"node_id": args.get("node_id"), "content": "select 1;"},
            }
        if tool_name == "list_flow_node_instances":
            return {"success": True, "data": [{"flow_node_id": 11, "status": "failed"}]}
        return {"success": True, "data": {"tool": tool_name, "args": args}}


def studio_connection_kwargs(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    """Extract connection kwargs for StudioClient from click context object."""
    keys = [
        "pat",
        "username",
        "password",
        "service",
        "instance",
        "workspace",
        "schema",
        "vcluster",
    ]
    out: dict[str, Any] = {}
    for key in keys:
        value = ctx_obj.get(key)
        if value is not None:
            out[key] = value
    return out
