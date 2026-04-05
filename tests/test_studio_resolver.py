"""Tests for shared Studio resolver guardrails."""

from __future__ import annotations

import pytest

from cz_cli.studio_resolver import (
    resolve_latest_run_id,
    resolve_run_id_or_task_name,
    resolve_task_id,
)


def test_resolve_latest_run_id_selects_newest_across_run_types():
    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            assert tool_name == "list_task_run"
            run_type = arguments.get("task_run_type")
            if run_type == 1:
                return type(
                    "R",
                    (),
                    {
                        "payload": {
                            "success": True,
                            "task_run_list": [{"task_run_id": 100, "execute_start_time": 1000}],
                        }
                    },
                )()
            if run_type == 3:
                return type(
                    "R",
                    (),
                    {
                        "payload": {
                            "success": True,
                            "task_run_list": [{"task_run_id": 300, "execute_start_time": 3000}],
                        }
                    },
                )()
            if run_type == 4:
                return type(
                    "R",
                    (),
                    {
                        "payload": {
                            "success": True,
                            "task_run_list": [{"task_run_id": 200, "execute_start_time": 2000}],
                        }
                    },
                )()
            raise AssertionError(f"unexpected run_type: {run_type}")

    run_id = resolve_latest_run_id(FakeClient(), "json", task_id=1)
    assert run_id == 300


def test_resolve_task_id_rejects_ambiguous_name():
    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            assert tool_name == "list_clickzetta_tasks"
            return type(
                "R",
                (),
                {
                    "payload": {
                        "success": True,
                        "tasks": [
                            {"task_id": 1, "task_name": "dup_name"},
                            {"task_id": 2, "task_name": "dup_name_x"},
                        ],
                    }
                },
            )()

    with pytest.raises(SystemExit) as exc:
        resolve_task_id(FakeClient(), "dup", "json")
    assert exc.value.code == 2


def test_resolve_run_id_or_task_name_uses_matching_task_with_latest_run():
    class FakeClient:
        def invoke(self, tool_name: str, arguments: dict):
            if tool_name == "list_clickzetta_tasks":
                return type(
                    "R",
                    (),
                    {
                        "payload": {
                            "success": True,
                            "tasks": [
                                {"task_id": 1, "task_name": "same_name"},
                                {"task_id": 2, "task_name": "same_name"},
                            ],
                        }
                    },
                )()
            if tool_name == "list_task_run":
                task_id = arguments.get("task_id")
                run_type = arguments.get("task_run_type")
                if task_id == 1:
                    return type("R", (), {"payload": {"success": True, "task_run_list": []}})()
                if task_id == 2 and run_type == 4:
                    return type(
                        "R",
                        (),
                        {
                            "payload": {
                                "success": True,
                                "task_run_list": [
                                    {"task_run_id": 24666399, "execute_start_time": 1775237877013}
                                ],
                            }
                        },
                    )()
                if task_id == 2:
                    return type("R", (), {"payload": {"success": True, "task_run_list": []}})()
                raise AssertionError(f"unexpected arguments: {arguments}")
            if tool_name == "get_task_instance_detail":
                return type(
                    "R",
                    (),
                    {
                        "payload": {
                            "success": True,
                            "task_detail": {
                                "taskInstanceId": arguments.get("task_instance_id"),
                                "executeStartTime": 1775237877013,
                            },
                        }
                    },
                )()
            raise AssertionError(f"unexpected tool call: {tool_name}")

    run_id = resolve_run_id_or_task_name(FakeClient(), "same_name", "json")
    assert run_id == 24666399
