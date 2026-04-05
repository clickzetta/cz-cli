"""Tests for dynamic ai-guide and skill generation."""

from __future__ import annotations

import json
from pathlib import Path

import click

from cz_cli.guide_builder import (
    build_ai_guide,
    build_command_inventory,
    generate_skill_markdown,
    skill_drift_diff,
    write_generated_skill,
)
from cz_cli.main import cli


def _normalize_usage(text: str) -> str:
    normalized = " ".join(text.split())
    if normalized.startswith("Usage:"):
        normalized = normalized.split(":", 1)[1].strip()
    return normalized


def _resolve_command_usage(root: click.Command, path: str) -> str:
    ctx = click.Context(root, info_name="cz-cli")
    command = root
    for token in path.split():
        if not isinstance(command, click.Group):
            raise AssertionError(f"Not a group while resolving {path}: {command}")
        next_command = command.get_command(ctx, token)
        if next_command is None:
            raise AssertionError(f"Unknown command token '{token}' in path '{path}'")
        ctx = click.Context(next_command, info_name=token, parent=ctx)
        command = next_command
    return _normalize_usage(command.get_usage(ctx))


def test_ai_guide_and_inventory_have_same_command_signatures() -> None:
    inventory = build_command_inventory(cli)
    ai_guide = build_ai_guide(cli, budget_chars=200000)

    guide_usage = {item["name"]: item["usage"] for item in ai_guide["commands"]}
    inventory_usage = {item["name"]: item["usage"] for item in inventory}

    assert guide_usage == inventory_usage


def test_help_usage_matches_inventory_usage() -> None:
    inventory = build_command_inventory(cli)

    for item in inventory:
        expected = item["usage"]
        actual = _resolve_command_usage(cli, item["name"])
        assert actual == expected


def test_inventory_includes_group_command_usage() -> None:
    inventory = build_command_inventory(cli)
    names = {item["name"] for item in inventory}
    usage_by_name = {item["name"]: item["usage"] for item in inventory}
    kind_by_name = {item["name"]: item["kind"] for item in inventory}

    assert "profile" in names
    assert "task flow" in names
    assert "profile show" in names
    assert usage_by_name["profile"].startswith("cz-cli profile [OPTIONS] COMMAND")
    assert usage_by_name["task flow"].startswith("cz-cli task flow [OPTIONS] COMMAND")
    assert kind_by_name["profile"] == "group"
    assert kind_by_name["task flow"] == "group"
    assert kind_by_name["profile show"] == "command"


def test_ai_guide_includes_kind_for_each_command() -> None:
    ai_guide = build_ai_guide(cli, budget_chars=200000)
    for item in ai_guide["commands"]:
        assert item["kind"] in {"group", "command"}


def test_generated_skill_contains_every_usage_signature() -> None:
    inventory = build_command_inventory(cli)
    skill_markdown = generate_skill_markdown(cli)

    assert "pip3 install cz-cli -U" in skill_markdown  # fallback install instruction still present
    assert "scripts/<platform>-<arch>/cz-cli" in skill_markdown  # binary-first delivery instruction
    assert "generated_cli_version" in skill_markdown
    assert "generated_with" in skill_markdown

    for item in inventory:
        assert f"`{item['usage']}`" in skill_markdown


def test_generated_skill_contains_examples_section() -> None:
    skill_markdown = generate_skill_markdown(cli)
    assert "## Examples" in skill_markdown
    assert '`cz-cli --profile dev sql "SELECT 1"`' in skill_markdown


def test_ai_guide_includes_shell_quote_hint_for_ddl() -> None:
    ai_guide = build_ai_guide(cli, budget_chars=200000)
    entry = next(item for item in ai_guide["commands"] if item["name"] == "table create")
    assert "shell_quote_hint" in entry
    assert "quotes" in entry["shell_quote_hint"]


def test_ai_guide_default_omits_task_create_options() -> None:
    ai_guide = build_ai_guide(cli)
    entry = next(item for item in ai_guide["commands"] if item["name"] == "task create")
    assert "options" not in entry
    assert "arguments" not in entry


def test_ai_guide_wide_includes_task_create_options() -> None:
    ai_guide = build_ai_guide(cli, wide=True)
    entry = next(item for item in ai_guide["commands"] if item["name"] == "task create")
    assert "options" in entry
    assert any("--folder-id" in opt.get("flags", []) for opt in entry["options"])


def test_ai_guide_default_is_smaller_than_wide() -> None:
    compact = build_ai_guide(cli)
    wide = build_ai_guide(cli, wide=True)
    assert len(json.dumps(compact, ensure_ascii=False)) < len(json.dumps(wide, ensure_ascii=False))


def test_ai_guide_budget_under_limit_keeps_full_sections() -> None:
    ai_guide = build_ai_guide(cli, wide=True, budget_chars=200000)

    assert ai_guide["truncation"]["applied"] is False
    assert "tips" in ai_guide
    assert "recommended_workflow" in ai_guide
    assert "options" in ai_guide["commands"][0]


def test_ai_guide_budget_over_limit_is_deterministic_and_preserves_mandatory_sections() -> None:
    first = build_ai_guide(cli, budget_chars=3000)
    second = build_ai_guide(cli, budget_chars=3000)

    assert first == second
    assert first["truncation"]["applied"] is True

    assert "global_options" in first
    assert "safety" in first
    assert "output_format" in first
    assert "exit_codes" in first
    assert first["commands"]
    for item in first["commands"]:
        assert item["name"]
        assert item["usage"]


def test_skill_drift_diff_detects_and_clears_drift(tmp_path: Path) -> None:
    target_path = tmp_path / "SKILL.md"
    target_path.write_text("stale\n", encoding="utf-8")

    diff_text = skill_drift_diff(cli, output_path=target_path)
    assert diff_text
    assert "stale" in diff_text

    write_generated_skill(cli, output_path=target_path)
    diff_after = skill_drift_diff(cli, output_path=target_path)
    assert diff_after == ""
