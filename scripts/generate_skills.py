#!/usr/bin/env python3
"""Generate or validate bundled skill documents."""

from __future__ import annotations

import argparse

from cz_cli.guide_builder import SKILL_OUTPUT_PATH, skill_drift_diff, write_generated_skill
from cz_cli.main import cli


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate cz-cli skill docs from Click metadata.")
    parser.add_argument("--check", action="store_true", help="Fail if generated output differs from committed SKILL.md")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.check:
        diff_text = skill_drift_diff(cli)
        if diff_text:
            print("Skill doc drift detected. Run: python scripts/generate_skills.py")
            print(diff_text)
            return 1
        print(f"Skill doc is up to date: {SKILL_OUTPUT_PATH}")
        return 0

    output_path = write_generated_skill(cli)
    print(f"Generated skill doc: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
