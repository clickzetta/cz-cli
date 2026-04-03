"""Custom Click Group that auto-injects --output/-o into every command."""

from __future__ import annotations

import click

_OUTPUT_CHOICES = ["json", "table", "csv", "jsonl", "toon"]


def _output_callback(ctx: click.Context, param: click.Option, value: str | None) -> str | None:
    """Store output format in ctx.obj so commands can read it without accepting the param."""
    if value is not None:
        ctx.ensure_object(dict)
        ctx.obj["format"] = value
    return value


class CLIGroup(click.Group):
    """Click Group that auto-injects --output/-o into every command."""

    def add_command(self, cmd: click.Command, name: str | None = None) -> None:
        _inject_output_option(cmd)
        super().add_command(cmd, name)


def _inject_output_option(cmd: click.Command) -> None:
    """Add --output/-o option to *cmd* if it doesn't already have one."""
    for p in cmd.params:
        if getattr(p, "name", None) == "output":
            return  # Already has an output format param
    _opt = click.Option(
        ["--output", "-o"],
        type=click.Choice(_OUTPUT_CHOICES),
        default=None,
        help="Output format (overrides global --output)",
        callback=_output_callback,
        expose_value=False,
    )
    cmd.params = [_opt] + cmd.params
