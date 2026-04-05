"""Helpers for extracting connection overrides from Click context."""

from __future__ import annotations

import click


def connection_kwargs_from_ctx(ctx: click.Context) -> dict[str, str]:
    """Build connection override kwargs from global CLI context."""
    keys = [
        "pat",
        "username",
        "password",
        "service",
        "protocol",
        "instance",
        "workspace",
        "schema",
        "vcluster",
    ]
    out: dict[str, str] = {}
    for key in keys:
        value = ctx.obj.get(key) if ctx.obj else None
        if value is not None:
            out[key] = value
    return out
