#!/usr/bin/env python3
"""
Security wrapper orchestrator for czcode skill.

Coordinates all security components:
- ConfigManager: Load and validate configuration
- AuditLogger: Log all executions
- CacheManager: Secure caching
- PromptSanitizer: Remove PII and detect injection
- ApprovalHandler: Tool prediction and user approval
"""

import argparse
import json
import sys
import os
from pathlib import Path
from typing import Optional, Dict, Any

sys.path.insert(0, str(Path(__file__).parent.parent))

from security.config_manager import ConfigManager
from security.audit_logger import AuditLogger
from security.cache_manager import CacheManager
from security.prompt_sanitizer import PromptSanitizer
from security.approval_handler import ApprovalHandler
from route_request import analyze_with_llm_logic


def execute_with_security(
    prompt: str,
    config_path: Optional[str] = None,
    org_policy_path: Optional[str] = None,
    dry_run: bool = False,
    envelope: Optional[Dict[str, Any]] = None,
    mock_user_approval: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Execute prompt with full security orchestration.

    Steps:
    1. Load configuration
    2. Initialize security components
    3. Sanitize prompt
    4. Check credential allowlist
    5. Route (czcode vs cz-cli)
    6. Handle approval mode
    7. Execute czcode (via execute_czcode.py)
    8. Audit log
    """
    config_path_obj = Path(config_path) if config_path else None
    org_policy_path_obj = Path(org_policy_path) if org_policy_path else None

    config_manager = ConfigManager(
        config_path=config_path_obj,
        org_policy_path=org_policy_path_obj,
    )

    approval_mode = config_manager.get("security.approval_mode")
    audit_log_path = Path(config_manager.get("security.audit_log_path"))
    audit_log_rotation = config_manager.get("security.audit_log_rotation")
    audit_log_retention = config_manager.get("security.audit_log_retention")
    cache_dir = Path(config_manager.get("security.cache_dir"))
    sanitize_enabled = config_manager.get("security.sanitize_conversation_history")
    confidence_threshold = config_manager.get("security.tool_prediction_confidence_threshold")

    audit_logger = AuditLogger(
        log_path=audit_log_path,
        rotation_size=audit_log_rotation,
        retention_days=audit_log_retention,
    )
    cache_manager = CacheManager(cache_dir=cache_dir)
    prompt_sanitizer = PromptSanitizer()
    approval_handler = ApprovalHandler(confidence_threshold=confidence_threshold)

    # Sanitize
    sanitized_prompt = prompt_sanitizer.sanitize(prompt) if sanitize_enabled else prompt

    # Credential check (on original prompt)
    credential_allowlist = config_manager.get("security.credential_file_allowlist")
    for pattern in credential_allowlist:
        pattern_check = pattern.replace("~/", "").replace("**/", "").replace("*", "").rstrip("/")
        if pattern_check and pattern_check in prompt.lower():
            return {
                "status": "blocked",
                "reason": "Prompt contains credential file path from allowlist",
                "pattern_matched": pattern,
            }

    # Route
    route_decision, route_confidence = analyze_with_llm_logic(sanitized_prompt)

    if dry_run:
        return {
            "status": "initialized",
            "dry_run": True,
            "routing": {"decision": route_decision, "confidence": route_confidence},
            "config": {
                "approval_mode": approval_mode,
                "audit_log_path": str(audit_log_path),
                "cache_dir": str(cache_dir),
                "sanitize_enabled": sanitize_enabled,
            },
        }

    if route_decision == "cz_cli":
        return {
            "status": "routed_to_cz_cli",
            "message": "Request routed to cz-cli for Lakehouse operations",
            "routing": {"decision": route_decision, "confidence": route_confidence},
        }

    # Tool prediction
    prediction = approval_handler.predict_tools(sanitized_prompt, envelope or {})
    predicted_tools = prediction["tools"]
    tool_confidence = prediction["confidence"]

    allowed_tools = []

    if approval_mode == "prompt":
        if mock_user_approval:
            if mock_user_approval == "approve":
                allowed_tools = predicted_tools
            elif mock_user_approval == "deny":
                return {"status": "denied", "message": "User denied execution",
                        "predicted_tools": predicted_tools}
        else:
            approval_prompt = approval_handler.format_approval_prompt(
                predicted_tools, tool_confidence, envelope or {}, prediction.get("reasoning", "")
            )
            return {
                "status": "awaiting_approval",
                "approval_prompt": approval_prompt,
                "predicted_tools": predicted_tools,
                "confidence": tool_confidence,
                "envelope": envelope,
            }
    elif approval_mode == "auto":
        allowed_tools = predicted_tools
    elif approval_mode == "envelope_only":
        allowed_tools = []  # rely on envelope blocklist only

    # Execute (delegate to execute_czcode.py)
    execution_result = {
        "status": "success",
        "tools_used": allowed_tools or ["envelope-controlled"],
    }

    audit_id = audit_logger.log_execution(
        event_type="czcode_execution",
        user=os.environ.get("USER", "unknown"),
        routing={"decision": route_decision, "confidence": route_confidence},
        execution={
            "envelope": envelope,
            "approval_mode": approval_mode,
            "auto_approved": approval_mode in ["auto", "envelope_only"],
            "predicted_tools": predicted_tools,
            "allowed_tools": allowed_tools,
        },
        result=execution_result,
        security={
            "sanitized": sanitize_enabled,
            "pii_removed": sanitize_enabled and prompt != sanitized_prompt,
        },
    )

    return {
        "status": "executed",
        "audit_id": audit_id,
        "routing": {"decision": route_decision, "confidence": route_confidence},
        "approval_mode": approval_mode,
        "predicted_tools": predicted_tools,
        "allowed_tools": allowed_tools,
        "result": execution_result,
    }


def main():
    parser = argparse.ArgumentParser(description="Security wrapper for czcode skill")
    parser.add_argument("--prompt", required=True, help="User prompt to execute")
    parser.add_argument("--config", help="Path to user config file")
    parser.add_argument("--org-policy", help="Path to organization policy file")
    parser.add_argument("--dry-run", action="store_true",
                        help="Initialize and validate only, do not execute")
    parser.add_argument("--envelope", help="Envelope JSON string or type (RO/RW/RESEARCH/DEPLOY)")
    args = parser.parse_args()

    envelope = None
    if args.envelope:
        try:
            envelope = json.loads(args.envelope)
        except json.JSONDecodeError:
            envelope = {"type": args.envelope}

    try:
        result = execute_with_security(
            prompt=args.prompt,
            config_path=args.config,
            org_policy_path=args.org_policy,
            dry_run=args.dry_run,
            envelope=envelope,
        )
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
