"""Fixtures for real Studio integration tests."""

from __future__ import annotations

from click.testing import CliRunner
import pytest


@pytest.fixture
def cli_runner() -> CliRunner:
    return CliRunner()

