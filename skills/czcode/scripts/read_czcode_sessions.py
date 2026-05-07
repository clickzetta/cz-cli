#!/usr/bin/env python3
"""
Reads recent czcode session data for context enrichment.
czcode stores sessions in a SQLite database at:
  $XDG_DATA_HOME/opencode/opencode-main.db  (Linux/macOS)
  ~/.local/share/opencode/opencode-main.db  (fallback)
"""

import json
import sys
import argparse
import sqlite3
from pathlib import Path
from datetime import datetime
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent.parent))
from security.prompt_sanitizer import PromptSanitizer


def get_sessions_db() -> Optional[Path]:
    """Find the czcode sessions SQLite database."""
    import os
    xdg_data = os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))
    db_path = Path(xdg_data) / "opencode" / "opencode-main.db"
    if db_path.exists():
        return db_path
    return None


def read_recent_sessions(limit: int = 3, sanitize: bool = True):
    """
    Read recent czcode sessions from the SQLite database.

    Returns a list of session summaries with last prompt and tools used.
    """
    db_path = get_sessions_db()
    if not db_path:
        print("czcode sessions database not found", file=sys.stderr)
        return []

    sanitizer = PromptSanitizer() if sanitize else None
    summaries = []

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # Get recent sessions ordered by update time
        cur.execute("""
            SELECT id, title, updated
            FROM session
            ORDER BY updated DESC
            LIMIT ?
        """, (limit,))
        sessions = cur.fetchall()

        for session in sessions:
            session_id = session["id"]
            title = session["title"] or ""
            updated = session["updated"]

            # Get last user message in this session
            cur.execute("""
                SELECT p.content
                FROM part p
                JOIN message m ON p.message_id = m.id
                WHERE m.session_id = ?
                  AND m.role = 'user'
                  AND p.type = 'text'
                ORDER BY m.created DESC
                LIMIT 1
            """, (session_id,))
            row = cur.fetchone()
            last_prompt = row["content"] if row else None
            if last_prompt and sanitizer:
                last_prompt = sanitizer.sanitize(last_prompt)

            # Get tools used in this session
            cur.execute("""
                SELECT DISTINCT p.tool_name
                FROM part p
                JOIN message m ON p.message_id = m.id
                WHERE m.session_id = ?
                  AND p.type = 'tool-invocation'
                  AND p.tool_name IS NOT NULL
            """, (session_id,))
            tools = [r["tool_name"] for r in cur.fetchall()]

            summaries.append({
                "session_id": session_id,
                "title": title,
                "updated": updated,
                "last_prompt": last_prompt,
                "tools_used": tools,
            })

        conn.close()

    except sqlite3.OperationalError as e:
        # Table schema may differ across versions -- degrade gracefully
        print(f"Warning: Could not read czcode sessions: {e}", file=sys.stderr)

    return summaries


def main():
    parser = argparse.ArgumentParser(description="Read recent czcode sessions")
    parser.add_argument("--limit", type=int, default=3,
                        help="Number of recent sessions to read")
    parser.add_argument("--no-sanitize", action="store_true",
                        help="Disable PII sanitization (for debugging)")
    args = parser.parse_args()

    summaries = read_recent_sessions(
        limit=args.limit,
        sanitize=not args.no_sanitize,
    )

    if not summaries:
        print("No recent czcode sessions found", file=sys.stderr)
        print(json.dumps([]))
        return 0

    print(f"Found {len(summaries)} recent sessions", file=sys.stderr)
    print(json.dumps(summaries, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
