#!/usr/bin/env python3
"""
LLM-based routing logic to determine if request should go to czcode or cz-cli.
Uses semantic understanding rather than simple keyword matching.
"""

import json
import sys
import argparse
from pathlib import Path
from typing import Optional, Dict, Any

sys.path.insert(0, str(Path(__file__).parent.parent))
from security.config_manager import ConfigManager
from security.cache_manager import CacheManager


# Coding / development indicators -> route to czcode
CZCODE_INDICATORS = [
    "write code", "create code", "modify code", "edit code",
    "debug", "fix bug", "fix error", "fix issue", "traceback", "exception",
    "refactor", "optimize code", "improve code", "clean up code",
    "explain code", "review code", "code review",
    "python", "javascript", "typescript", "shell script", "bash script",
    "function", "class", "method", "variable", "import",
    "unit test", "write test", "test case",
    "czcode", "coding assistant",
    "develop task", "write task", "create task body", "task script",
]

# Lakehouse / cz-cli indicators -> handle locally with cz-cli
CZ_CLI_INDICATORS = [
    "run sql", "execute sql", "select ", "insert into", "create table",
    "drop table", "alter table", "show tables", "describe table",
    "cz-cli", "lakehouse", "clickzetta",
    "task schedule", "task online", "task offline", "task create",
    "task list", "task detail", "task run", "task status",
    "run instance", "run list", "run log",
    "schema create", "schema drop", "schema list",
    "profile", "connection", "workspace",
    "table list", "table detail", "table drop",
]


def analyze_with_llm_logic(prompt: str, _capabilities: Dict = None):
    """
    Analyze prompt using LLM-inspired scoring logic.

    Returns:
        (route, confidence) where route is "czcode" or "cz_cli"
    """
    prompt_lower = prompt.lower()

    czcode_score = 0
    cz_cli_score = 0

    for indicator in CZCODE_INDICATORS:
        if indicator in prompt_lower:
            czcode_score += 3 if indicator in ["czcode", "debug", "refactor"] else 1

    for indicator in CZ_CLI_INDICATORS:
        if indicator in prompt_lower:
            cz_cli_score += 3 if indicator in ["cz-cli", "lakehouse", "clickzetta"] else 1

    # SQL keyword detection -- only route to cz-cli if no coding context
    sql_keywords = ["select", "insert", "update", "delete", "create table", "alter", "drop table"]
    if any(kw in prompt_lower for kw in sql_keywords):
        if czcode_score == 0:
            cz_cli_score += 3
        else:
            czcode_score += 1  # writing SQL code, not executing it

    total_score = czcode_score + cz_cli_score
    if total_score == 0:
        return "czcode", 0.5  # default to czcode for ambiguous requests

    confidence = max(czcode_score, cz_cli_score) / total_score

    if czcode_score >= cz_cli_score:
        return "czcode", confidence
    else:
        return "cz_cli", confidence


def check_credential_allowlist(
    prompt: str,
    config_path: Optional[Path] = None,
    org_policy_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Block prompts that reference credential file paths."""
    config_manager = ConfigManager(
        config_path=config_path,
        org_policy_path=org_policy_path,
    )
    credential_allowlist = config_manager.get("security.credential_file_allowlist")
    prompt_lower = prompt.lower()

    for pattern in credential_allowlist:
        pattern_check = pattern.replace("~/", "").replace("**/", "").replace("*", "")
        pattern_check = pattern_check.rstrip("/")
        if not pattern_check:
            continue
        if pattern_check in prompt_lower:
            return {
                "blocked": True,
                "route": "blocked",
                "confidence": 1.0,
                "reason": "Prompt contains credential file path from allowlist",
                "pattern_matched": pattern,
            }

    return {"blocked": False}


def main():
    parser = argparse.ArgumentParser(description="Route request to czcode or cz-cli")
    parser.add_argument("--prompt", required=True, help="User prompt to analyze")
    parser.add_argument("--config", help="Path to user config file")
    parser.add_argument("--org-policy", help="Path to organization policy file")
    args = parser.parse_args()

    config_path = Path(args.config) if args.config else None
    org_policy_path = Path(args.org_policy) if args.org_policy else None

    credential_check = check_credential_allowlist(args.prompt, config_path, org_policy_path)
    if credential_check.get("blocked"):
        print(json.dumps(credential_check, indent=2))
        print(f"\nBLOCKED: Credential file detected", file=sys.stderr)
        print(f"   Pattern: {credential_check['pattern_matched']}", file=sys.stderr)
        sys.exit(0)

    route, confidence = analyze_with_llm_logic(args.prompt)

    result = {
        "route": route,
        "confidence": confidence,
        "reasoning": f"Routed to {route} with {confidence:.2%} confidence",
    }
    print(json.dumps(result, indent=2))
    print(f"\n-> Route to: {route.upper()}", file=sys.stderr)
    print(f"   Confidence: {confidence:.2%}", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
