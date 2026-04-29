#!/usr/bin/env python3
"""Execute czagent in headless mode and return structured output.

Usage:
    python3 execute_czagent.py --prompt "your query" [--session <id>]

Designed to be called by host AI agents (Claude Code, Codex, Cursor, etc.)
as a subagent for ClickZetta Lakehouse operations.
"""

import argparse
import json
import os
import subprocess
import sys
import threading


def find_czagent() -> str:
    candidates = [
        os.path.expanduser("~/.local/bin/czagent"),
        "czagent",
    ]
    for c in candidates:
        expanded = os.path.expanduser(c)
        if os.path.isfile(expanded) and os.access(expanded, os.X_OK):
            return expanded
    for c in candidates:
        if c == "czagent":
            from shutil import which
            found = which(c)
            if found:
                return found
    print(json.dumps({"error": "czagent binary not found. Run the setup script first."}))
    sys.exit(1)


def heartbeat(interval: float = 15.0, stop_event: threading.Event = None):
    while not stop_event.is_set():
        print(".", end="", file=sys.stderr, flush=True)
        stop_event.wait(interval)


def run_czagent(prompt: str, session_id: str = None) -> dict:
    czagent = find_czagent()

    cmd = [czagent, "run", prompt, "--format", "json", "--dangerously-skip-permissions"]
    if session_id:
        cmd.extend(["--session", session_id])

    stop = threading.Event()
    hb = threading.Thread(target=heartbeat, args=(15.0, stop), daemon=True)
    hb.start()

    try:
        proc = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=300,
        )
    except subprocess.TimeoutExpired:
        stop.set()
        return {"error": "czagent timed out after 300 seconds"}
    finally:
        stop.set()

    if proc.returncode != 0:
        stderr_text = proc.stderr.strip() if proc.stderr else ""
        return {"error": f"czagent exited with code {proc.returncode}", "stderr": stderr_text}

    stdout = proc.stdout.strip()
    if not stdout:
        return {"error": "czagent returned empty output", "stderr": proc.stderr.strip() if proc.stderr else ""}

    session = None
    texts = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not session and event.get("sessionID"):
            session = event["sessionID"]
        part = event.get("part", {})
        if part.get("type") == "text" and part.get("text"):
            texts.append(part["text"])

    result_text = "".join(texts).strip()
    data = {"result": result_text}
    if session:
        data["session_id"] = session
    return data


def main():
    parser = argparse.ArgumentParser(description="Execute czagent headless")
    parser.add_argument("--prompt", required=True, help="The prompt to send to czagent")
    parser.add_argument("--session", default=None, help="Session ID for follow-up queries")
    args = parser.parse_args()

    result = run_czagent(args.prompt, args.session)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
