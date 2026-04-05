"""Serial real-environment integration tests for Studio task/runs/executions commands."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from tests.integration.runner import load_integration_scenarios, run_scenario

pytestmark = pytest.mark.integration

CASES_DIR = Path(__file__).parent / "cases"
SCENARIOS = load_integration_scenarios(CASES_DIR)


def test_studio_integration_scenarios_serial(cli_runner) -> None:
    if os.environ.get("CZ_RUN_INTEGRATION") != "1":
        pytest.skip("Set CZ_RUN_INTEGRATION=1 to run real Studio integration tests.")

    profile_name = os.environ.get("CZ_IT_PROFILE") or "dev"
    missing_env_by_scenario: list[str] = []
    for scenario in SCENARIOS:
        scenario_name = scenario.get("scenario", "unnamed-scenario")
        requires_env = scenario.get("requires_env", []) or []
        missing: list[str] = []
        for name in requires_env:
            if name == "CZ_IT_PROFILE":
                if profile_name:
                    continue
            if not os.environ.get(name):
                missing.append(name)
        if missing:
            missing_env_by_scenario.append(f"{scenario_name}: {', '.join(missing)}")
    assert not missing_env_by_scenario, (
        "Missing required env vars for integration scenarios:\n- "
        + "\n- ".join(missing_env_by_scenario)
    )

    for scenario in SCENARIOS:
        run_scenario(cli_runner, scenario)
