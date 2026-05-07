#!/usr/bin/env python3
"""
Executes czcode in headless mode with streaming output parsing.
Uses --permission-mode bypass for headless auto-approval and
--output-format stream-json for streaming results.
Handles tool use events and final results.
"""

import json
import subprocess
import sys
import argparse
import threading
from typing import List, Dict, Optional


# Known tools for inversion logic (allowed -> disallowed)
KNOWN_TOOLS = [
    "Read", "Write", "Edit", "Bash", "Grep", "Glob",
    "WebFetch", "WebSearch", "TodoWrite", "Agent",
]


def invert_tools_to_disallowed(allowed_tools: List[str]) -> List[str]:
    """Convert allowed tools list to disallowed tools list."""
    return [tool for tool in KNOWN_TOOLS if tool not in allowed_tools]


def execute_czcode_streaming(
    prompt: str,
    disallowed_tools: Optional[List[str]] = None,
    envelope: str = "RW",
    approval_mode: str = "auto",
    allowed_tools: Optional[List[str]] = None,
    system_prompt: Optional[str] = None,
    add_dirs: Optional[List[str]] = None,
) -> Dict:
    """
    Execute czcode with streaming JSON output in headless mode.

    Args:
        prompt: The enriched prompt to send to czcode
        disallowed_tools: Optional list of tools to explicitly block
        envelope: Security envelope mode (RO, RW, RESEARCH, DEPLOY, NONE)
        approval_mode: Approval mode (prompt, auto, envelope_only)
        allowed_tools: Optional list of tools that ARE allowed (for prompt mode)
        system_prompt: Optional system prompt to prepend
        add_dirs: Optional additional directories to add to working context

    Returns:
        Dictionary with execution results
    """
    cmd = [
        "czcode",
        "--print", prompt,
        "--output-format", "stream-json",
        "--permission-mode", "bypass",
    ]

    if system_prompt:
        cmd.extend(["--system-prompt", system_prompt])

    if add_dirs:
        for d in add_dirs:
            cmd.extend(["--add-dir", d])

    # Build disallowed tools list based on approval mode and envelope
    final_disallowed_tools = list(disallowed_tools or [])

    if approval_mode == "prompt":
        if allowed_tools is not None:
            inverted = invert_tools_to_disallowed(allowed_tools)
            final_disallowed_tools = list(set(final_disallowed_tools) | set(inverted))
        else:
            final_disallowed_tools = list(set(final_disallowed_tools) | set(KNOWN_TOOLS))
    elif approval_mode in ["envelope_only", "auto"]:
        envelope_tools: List[str] = []
        if envelope == "RO":
            envelope_tools = [
                "Edit", "Write",
                "Bash(rm *)", "Bash(rm -rf *)", "Bash(rm -r *)",
                "Bash(sudo *)", "Bash(chmod 777 *)",
                "Bash(git push *)", "Bash(git reset --hard *)",
            ]
        elif envelope == "RESEARCH":
            envelope_tools = [
                "Edit", "Write",
                "Bash(rm *)", "Bash(rm -rf *)", "Bash(rm -r *)",
                "Bash(sudo *)", "Bash(chmod 777 *)",
            ]
        elif envelope == "DEPLOY":
            envelope_tools = []
        # RW: block only destructive ops
        elif envelope == "RW":
            envelope_tools = [
                "Bash(rm -rf *)", "Bash(sudo rm *)",
            ]
        if envelope_tools:
            final_disallowed_tools = list(set(final_disallowed_tools) | set(envelope_tools))

    if final_disallowed_tools:
        for tool in final_disallowed_tools:
            cmd.extend(["--disallowedTools", tool])

    debug_cmd = 'czcode --print "..." --output-format stream-json --permission-mode bypass'
    if final_disallowed_tools:
        debug_cmd += f" --disallowedTools {' '.join(final_disallowed_tools[:3])}"
        if len(final_disallowed_tools) > 3:
            debug_cmd += "..."
    print(debug_cmd, file=sys.stderr)

    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        results: Dict = {
            "session_id": None,
            "events": [],
            "permission_requests": [],
            "final_result": None,
            "error": None,
        }

        # Heartbeat: print a dot every 5 seconds while czcode is running.
        # Some AI tools (Codex) background commands with no stdout for ~10s --
        # the heartbeat keeps them polling so the final answer isn't missed.
        _done = threading.Event()

        def _heartbeat():
            while not _done.wait(5):
                print(".", end="", flush=True)

        hb = threading.Thread(target=_heartbeat, daemon=True)
        hb.start()

        for line in process.stdout:
            if not line.strip():
                continue
            try:
                event = json.loads(line)
                results["events"].append(event)
                event_type = event.get("type")

                if event_type == "system" and event.get("subtype") == "init":
                    results["session_id"] = event.get("session_id")
                    print(f"-> Started czcode session: {results['session_id']}", file=sys.stderr)

                elif event_type == "assistant":
                    message = event.get("message", {})
                    content = message.get("content", [])
                    for item in content:
                        if item.get("type") == "text":
                            print(item.get("text", ""), flush=True)
                        elif item.get("type") == "tool_use":
                            print(f"[czcode] Using tool: {item.get('name')}", file=sys.stderr)

                elif event_type == "user":
                    message = event.get("message", {})
                    content = message.get("content", [])
                    for item in content:
                        if item.get("type") == "tool_result":
                            tool_content = item.get("content", "")
                            if isinstance(tool_content, str) and (
                                "Permission denied" in tool_content
                                or "denied" in tool_content.lower()
                            ):
                                results["permission_requests"].append({
                                    "tool_use_id": item.get("tool_use_id"),
                                    "content": tool_content,
                                })
                                print(f"[czcode] Permission request: {tool_content}", file=sys.stderr)

                elif event_type == "result":
                    results["final_result"] = event.get("result")

            except json.JSONDecodeError as e:
                print(f"Warning: Failed to parse line: {line[:100]}... Error: {e}", file=sys.stderr)
                continue

        _done.set()
        print(flush=True)
        process.wait()

        if process.returncode != 0:
            stderr_output = process.stderr.read()
            results["error"] = stderr_output
            print(f"Error: czcode exited with code {process.returncode}", file=sys.stderr)
            print(f"Stderr: {stderr_output}", file=sys.stderr)

        return results

    except FileNotFoundError:
        return {
            "session_id": None,
            "events": [],
            "permission_requests": [],
            "final_result": None,
            "error": "czcode not found. Install it or check PATH. Fallback: ~/.local/bin/czcode",
        }
    except Exception as e:
        return {
            "session_id": None,
            "events": [],
            "permission_requests": [],
            "final_result": None,
            "error": str(e),
        }


def main():
    parser = argparse.ArgumentParser(description="Execute czcode headlessly")
    parser.add_argument("--prompt", required=True, help="Prompt to send to czcode")
    parser.add_argument("--disallowed-tools", nargs="+", help="Tools to explicitly block")
    parser.add_argument("--envelope", default="RW",
                        choices=["RO", "RW", "RESEARCH", "DEPLOY", "NONE"],
                        help="Security envelope mode (default: RW)")
    parser.add_argument("--approval-mode", default="auto",
                        choices=["prompt", "auto", "envelope_only"],
                        help="Approval mode (default: auto)")
    parser.add_argument("--allowed-tools", nargs="+",
                        help="Tools that are allowed (for prompt mode)")
    parser.add_argument("--system-prompt", help="System prompt to prepend")
    parser.add_argument("--add-dir", nargs="+", dest="add_dirs",
                        help="Additional directories to add to working context")
    args = parser.parse_args()

    results = execute_czcode_streaming(
        args.prompt,
        disallowed_tools=args.disallowed_tools,
        envelope=args.envelope,
        approval_mode=args.approval_mode,
        allowed_tools=args.allowed_tools,
        system_prompt=args.system_prompt,
        add_dirs=args.add_dirs,
    )

    print(json.dumps(results, indent=2))
    return 1 if results.get("error") else 0


if __name__ == "__main__":
    sys.exit(main())
