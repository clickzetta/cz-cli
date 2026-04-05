"""Build dynamic AI guide payload and generated skill documents."""

from __future__ import annotations

import copy
import difflib
import json
import os
from pathlib import Path
from typing import Any

import click

from cz_cli.version import __version__

GUIDE_GENERATOR_VERSION = "1.0.0"
DEFAULT_AI_GUIDE_BUDGET_CHARS = 20000

SKILL_TEMPLATE_PATH = Path(__file__).resolve().parent / "SKILL.template.md"
SKILL_OUTPUT_PATH = Path(__file__).resolve().parent / "skills" / "cz-cli" / "SKILL.md"


def _normalize_whitespace(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(value.split())


def _as_click_group(command: click.Command) -> click.Group | None:
    if isinstance(command, click.Group):
        return command
    return None


def _safe_default(option: click.Option, ctx: click.Context) -> Any:
    try:
        default = option.get_default(ctx)
    except Exception:
        default = option.default

    if default in (None, "", (), []):
        return None

    if default.__class__.__name__ == "Sentinel":
        return None

    if isinstance(default, tuple):
        return list(default)

    return _json_safe_value(default)


def _json_safe_value(value: Any) -> Any:
    if value.__class__.__name__ == "Sentinel":
        return None

    if isinstance(value, tuple):
        return [_json_safe_value(item) for item in value]

    if isinstance(value, list):
        return [_json_safe_value(item) for item in value]

    if isinstance(value, dict):
        return {str(key): _json_safe_value(item) for key, item in value.items()}

    if isinstance(value, (str, int, float, bool)) or value is None:
        return value

    try:
        json.dumps(value)
    except TypeError:
        return str(value)
    return value


def _serialize_option(option: click.Option, ctx: click.Context) -> dict[str, Any]:
    names = [*option.opts, *option.secondary_opts]
    item: dict[str, Any] = {
        "flags": names,
        "required": bool(option.required),
        "takes_value": not option.is_flag,
    }

    metavar = _normalize_whitespace(option.make_metavar(ctx))
    if metavar and not option.is_flag:
        item["metavar"] = metavar

    help_text = _normalize_whitespace(option.help)
    if help_text:
        item["help"] = help_text

    default = _safe_default(option, ctx)
    if default is not None:
        item["default"] = default

    return item


def _serialize_argument(argument: click.Argument, ctx: click.Context) -> dict[str, Any]:
    item: dict[str, Any] = {
        "name": argument.human_readable_name,
        "required": bool(argument.required),
        "nargs": argument.nargs,
    }

    metavar = _normalize_whitespace(argument.make_metavar(ctx))
    if metavar:
        item["metavar"] = metavar

    default = argument.default
    if default not in (None, "", (), []):
        json_safe_default = _json_safe_value(default)
        if json_safe_default is not None:
            item["default"] = json_safe_default

    return item


def _extract_usage(command: click.Command, ctx: click.Context) -> str:
    raw = command.get_usage(ctx)
    if raw.startswith("Usage:"):
        raw = raw.split(":", 1)[1]
    return _normalize_whitespace(raw)


def _extract_description(command: click.Command) -> str:
    description = _normalize_whitespace(command.short_help)
    if description:
        return description
    description = _normalize_whitespace(command.help)
    if description:
        return description
    return "No description."


def _command_kind(command: click.Command) -> str:
    return "group" if _as_click_group(command) is not None else "command"


def _extract_shell_quote_hint(arguments: list[dict[str, Any]]) -> str | None:
    names = {str(arg.get("name", "")).upper() for arg in arguments}
    if "DDL" in names:
        return 'Shell tip: wrap DDL in quotes (e.g. "CREATE TABLE ...") or use --from-file.'
    if "STATEMENT" in names:
        return "Shell tip: wrap SQL statement in quotes, or pass -f/--file for complex statements."
    return None


def _build_command_entry(
    path: list[str], command: click.Command, ctx: click.Context
) -> dict[str, Any]:
    options: list[dict[str, Any]] = []
    arguments: list[dict[str, Any]] = []

    for param in command.params:
        if isinstance(param, click.Option):
            options.append(_serialize_option(param, ctx))
        elif isinstance(param, click.Argument):
            arguments.append(_serialize_argument(param, ctx))

    entry = {
        "name": " ".join(path),
        "kind": _command_kind(command),
        "usage": _extract_usage(command, ctx),
        "description": _extract_description(command),
        "options": options,
        "arguments": arguments,
    }
    shell_quote_hint = _extract_shell_quote_hint(arguments)
    if shell_quote_hint:
        entry["shell_quote_hint"] = shell_quote_hint
    return entry


def _walk_command_tree(
    command: click.Command,
    ctx: click.Context,
    path: list[str],
    inventory: list[dict[str, Any]],
) -> None:
    group = _as_click_group(command)
    if group is None:
        inventory.append(_build_command_entry(path, command, ctx))
        return

    # Include group commands themselves so every subcommand path has a usage signature.
    inventory.append(_build_command_entry(path, command, ctx))

    subcommand_names = sorted(group.list_commands(ctx))
    if not subcommand_names:
        return

    for name in subcommand_names:
        subcommand = group.get_command(ctx, name)
        if subcommand is None:
            continue
        child_ctx = click.Context(subcommand, info_name=name, parent=ctx)
        _walk_command_tree(subcommand, child_ctx, [*path, name], inventory)


def build_command_inventory(
    root: click.Command, *, cli_name: str = "cz-cli"
) -> list[dict[str, Any]]:
    """Return deterministic command metadata extracted from Click command tree."""
    inventory: list[dict[str, Any]] = []
    root_ctx = click.Context(root, info_name=cli_name)

    root_group = _as_click_group(root)
    if root_group is None:
        return [_build_command_entry([cli_name], root, root_ctx)]

    for top_name in sorted(root_group.list_commands(root_ctx)):
        top_command = root_group.get_command(root_ctx, top_name)
        if top_command is None:
            continue
        child_ctx = click.Context(top_command, info_name=top_name, parent=root_ctx)
        _walk_command_tree(top_command, child_ctx, [top_name], inventory)

    inventory.sort(key=lambda item: item["name"])
    return inventory


def _serialize_payload_length(payload: dict[str, Any]) -> int:
    return len(json.dumps(payload, ensure_ascii=False, indent=2))


def _trim_option_help_and_default(payload: dict[str, Any]) -> bool:
    changed = False
    for command in payload.get("commands", []):
        for option in command.get("options", []):
            if "help" in option:
                option.pop("help", None)
                changed = True
            if "default" in option:
                option.pop("default", None)
                changed = True
    return changed


def _drop_parameter_details(payload: dict[str, Any]) -> bool:
    changed = False
    for command in payload.get("commands", []):
        if command.pop("options", None) is not None:
            changed = True
        if command.pop("arguments", None) is not None:
            changed = True
    return changed


def _drop_global_examples(payload: dict[str, Any]) -> bool:
    global_options = payload.get("global_options", {})
    if "examples" not in global_options:
        return False
    global_options.pop("examples", None)
    return True


def _drop_recommended_workflow(payload: dict[str, Any]) -> bool:
    if "recommended_workflow" not in payload:
        return False
    payload.pop("recommended_workflow", None)
    return True


def _drop_tips(payload: dict[str, Any]) -> bool:
    if "tips" not in payload:
        return False
    payload.pop("tips", None)
    return True


def _drop_descriptions(payload: dict[str, Any]) -> bool:
    changed = False
    for command in payload.get("commands", []):
        if command.pop("description", None) is not None:
            changed = True
    return changed


def _apply_budget(payload: dict[str, Any], budget_chars: int) -> dict[str, Any]:
    before_chars = _serialize_payload_length(payload)
    applied_steps: list[str] = []

    if before_chars <= budget_chars:
        payload["truncation"] = {
            "applied": False,
            "budget_chars": budget_chars,
            "estimated_chars_before": before_chars,
            "estimated_chars_after": before_chars,
            "steps_applied": [],
            "mandatory_sections": [
                "global_options.usage_pattern",
                "commands[].name",
                "commands[].kind",
                "commands[].usage",
                "safety",
                "output_format",
                "exit_codes",
            ],
        }
        return payload

    trim_steps: list[tuple[str, Any]] = [
        ("drop_option_help_and_default", _trim_option_help_and_default),
        ("drop_parameter_details", _drop_parameter_details),
        ("drop_global_examples", _drop_global_examples),
        ("drop_recommended_workflow", _drop_recommended_workflow),
        ("drop_tips", _drop_tips),
        ("drop_command_descriptions", _drop_descriptions),
    ]

    for step_name, step_fn in trim_steps:
        changed = bool(step_fn(payload))
        current_chars = _serialize_payload_length(payload)
        if changed:
            applied_steps.append(step_name)
        if current_chars <= budget_chars:
            break

    after_chars = _serialize_payload_length(payload)
    payload["truncation"] = {
        "applied": True,
        "budget_chars": budget_chars,
        "estimated_chars_before": before_chars,
        "estimated_chars_after": after_chars,
        "steps_applied": applied_steps,
        "mandatory_sections": [
            "global_options.usage_pattern",
            "commands[].name",
            "commands[].kind",
            "commands[].usage",
            "safety",
            "output_format",
            "exit_codes",
        ],
    }
    return payload


def _resolve_budget(budget_chars: int | None = None, *, wide: bool = False) -> int:
    if budget_chars is not None:
        return max(2000, budget_chars)

    env_budget = os.environ.get("CZ_AI_GUIDE_BUDGET", "").strip()
    if not env_budget:
        return 200000 if wide else DEFAULT_AI_GUIDE_BUDGET_CHARS

    try:
        parsed = int(env_budget)
    except ValueError:
        return 200000 if wide else DEFAULT_AI_GUIDE_BUDGET_CHARS
    return max(2000, parsed)


def build_ai_guide(
    root: click.Command,
    *,
    cli_name: str = "cz-cli",
    cli_version: str = __version__,
    wide: bool = False,
    budget_chars: int | None = None,
) -> dict[str, Any]:
    """Build ai-guide payload from Click metadata with deterministic budget trimming."""
    command_inventory = build_command_inventory(root, cli_name=cli_name)

    root_ctx = click.Context(root, info_name=cli_name)
    global_options = [
        _serialize_option(option, root_ctx)
        for option in root.params
        if isinstance(option, click.Option)
    ]

    payload: dict[str, Any] = {
        "name": cli_name,
        "version": cli_version,
        "guide_generator_version": GUIDE_GENERATOR_VERSION,
        "description": "AI-Agent-friendly CLI for ClickZetta Lakehouse",
        "global_options": {
            "order": "Global options must appear before subcommand.",
            "usage_pattern": (
                f"{cli_name} [GLOBAL_OPTIONS] <subcommand> [args] "
                f"(or run {cli_name} <subcommand> [args] --output pretty)"
            ),
            "entry_commands": ["cz-cli", "clickzetta-cli"],
            "options": global_options,
            "examples": [
                f'{cli_name} --profile dev sql "SELECT 1"',
                f"{cli_name} --output table task list --limit 5",
                f"{cli_name} runs list --task my_task --run-type REFILL --limit 1",
            ],
        },
        "recommended_workflow": [
            f"{cli_name} profile create <name> --username ... --password ... --instance ... --workspace ...",
            f"{cli_name} schema list",
            f"{cli_name} table list --schema public",
            f'{cli_name} sql "SELECT ... LIMIT 20"',
        ],
        "commands": command_inventory,
        "output_format": {
            "success": {"ok": True, "data": "...", "time_ms": "N"},
            "error": {"ok": False, "error": {"code": "...", "message": "..."}},
            "note": "Use -o pretty for colorized human-friendly JSON output.",
        },
        "safety": {
            "write_protection": "Write operations require --write. DELETE/UPDATE without WHERE are blocked.",
            "confirmation": "task online/offline, runs stop/refill, executions stop require confirmation unless -y.",
            "pagination": "task list / runs list / executions list default to page 1; use --page/--page-size or --limit.",
        },
        "exit_codes": {"0": "success", "1": "business error", "2": "usage error"},
        "tips": {
            "help": f"Run '{cli_name} <subcommand> --help' to inspect exact parameter contracts.",
            "profile": "Use --profile for reusable connection config; protocol can be overridden per profile.",
        },
    }

    # Default view is compact: keep command signatures and safety contracts,
    # and let caller opt into parameter-level details via --wide.
    if not wide:
        _drop_parameter_details(payload)

    return _apply_budget(copy.deepcopy(payload), _resolve_budget(budget_chars, wide=wide))


def _skill_inventory_markdown(inventory: list[dict[str, Any]]) -> str:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in inventory:
        top_level = item["name"].split(" ", 1)[0]
        grouped.setdefault(top_level, []).append(item)

    lines: list[str] = []
    for top_level in sorted(grouped):
        lines.append(f"### `{top_level}`")
        for entry in sorted(grouped[top_level], key=lambda x: x["name"]):
            lines.append(f"- `{entry['usage']}` - {entry['description']}")
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def render_skill_markdown(
    root: click.Command,
    *,
    template_text: str,
    cli_name: str = "cz-cli",
    cli_version: str = __version__,
) -> str:
    """Render skill markdown from template and dynamic command inventory."""
    inventory = build_command_inventory(root, cli_name=cli_name)
    command_inventory = _skill_inventory_markdown(inventory)

    rendered = template_text
    replacements = {
        "{{CLI_VERSION}}": cli_version,
        "{{GENERATOR_VERSION}}": GUIDE_GENERATOR_VERSION,
        "{{COMMAND_COUNT}}": str(len(inventory)),
        "{{COMMAND_INVENTORY}}": command_inventory.rstrip(),
    }
    for key, value in replacements.items():
        rendered = rendered.replace(key, value)

    return rendered.rstrip() + "\n"


def generate_skill_markdown(
    root: click.Command,
    *,
    template_path: Path = SKILL_TEMPLATE_PATH,
    cli_name: str = "cz-cli",
    cli_version: str = __version__,
) -> str:
    """Generate skill markdown text from template path."""
    template_text = template_path.read_text(encoding="utf-8")
    return render_skill_markdown(
        root,
        template_text=template_text,
        cli_name=cli_name,
        cli_version=cli_version,
    )


def write_generated_skill(
    root: click.Command,
    *,
    output_path: Path = SKILL_OUTPUT_PATH,
    template_path: Path = SKILL_TEMPLATE_PATH,
    cli_name: str = "cz-cli",
    cli_version: str = __version__,
) -> Path:
    """Generate and write skill markdown to disk."""
    rendered = generate_skill_markdown(
        root,
        template_path=template_path,
        cli_name=cli_name,
        cli_version=cli_version,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rendered, encoding="utf-8")
    return output_path


def skill_drift_diff(
    root: click.Command,
    *,
    output_path: Path = SKILL_OUTPUT_PATH,
    template_path: Path = SKILL_TEMPLATE_PATH,
    cli_name: str = "cz-cli",
    cli_version: str = __version__,
) -> str:
    """Return unified diff when committed skill content drifts from generator output."""
    expected = generate_skill_markdown(
        root,
        template_path=template_path,
        cli_name=cli_name,
        cli_version=cli_version,
    )
    actual = output_path.read_text(encoding="utf-8") if output_path.exists() else ""
    if expected == actual:
        return ""

    diff = difflib.unified_diff(
        actual.splitlines(),
        expected.splitlines(),
        fromfile=str(output_path),
        tofile=f"{output_path} (generated)",
        lineterm="",
    )
    return "\n".join(diff)
