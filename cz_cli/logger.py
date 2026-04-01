"""Operation logging to ~/.clickzetta/sql-history.jsonl (cz-cli SQL execution history)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_LOG_DIR = Path.home() / ".clickzetta"
_LOG_FILE = _LOG_DIR / "sql-history.jsonl"

# Patterns to detect and mask sensitive literals in SQL (for sql-history log only)
_RE_QUOTED = re.compile(r"'([^']*)'")
_RE_PHONE = re.compile(r"^1[3-9]\d{9}$")
_RE_IDCARD = re.compile(r"^\d{17}[\dXx]?$")
_RE_SENSITIVE_COL = re.compile(
    r"(password|passwd|secret|api_key|apikey|phone|mobile|id_card|idcard|email)\s*[,)]",
    re.I,
)


def _redact_sql(sql: str) -> str:
    """Redact sensitive string literals in SQL so sql-history.jsonl does not store plaintext secrets."""
    last_end = 0
    prefix = ""
    out: list[str] = []

    for m in _RE_QUOTED.finditer(sql):
        out.append(sql[last_end : m.start()])
        val = m.group(1)
        redacted: str | None = None
        if _RE_PHONE.match(val):
            digits = re.sub(r"\D", "", val)
            redacted = digits[:3] + "****" + digits[-4:] if len(digits) >= 7 else "****"
        elif _RE_IDCARD.match(val):
            redacted = val[:3] + "*" * (len(val) - 7) + val[-4:] if len(val) >= 6 else "****"
        elif "@" in val:
            parts = val.rsplit("@", 1)
            local, domain = parts[0], parts[1]
            redacted = (local[0] + "***@" + domain) if len(local) > 1 else "***@" + domain
        else:
            prefix = sql[: m.start()]
            if len(prefix) > 400:
                prefix = prefix[-400:]
            if _RE_SENSITIVE_COL.search(prefix) and re.match(r"^[\w\d_]+$", val) and len(val) >= 6:
                redacted = "******"
        if redacted is not None:
            out.append("'" + redacted + "'")
        else:
            out.append(m.group(0))
        last_end = m.end()

    out.append(sql[last_end:])
    return "".join(out)


def log_operation(
    command: str,
    *,
    sql: str | None = None,
    ok: bool = True,
    rows: int | None = None,
    affected: int | None = None,
    time_ms: int = 0,
    error_code: str | None = None,
) -> None:
    """Append one JSONL entry to the history log. Failures are silently ignored."""
    entry: dict[str, Any] = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
        "command": command,
    }
    if sql is not None:
        entry["sql"] = _redact_sql(sql)
    entry["ok"] = ok
    if rows is not None:
        entry["rows"] = rows
    if affected is not None:
        entry["affected"] = affected
    if time_ms:
        entry["time_ms"] = time_ms
    if error_code:
        entry["error_code"] = error_code

    try:
        _LOG_DIR.mkdir(parents=True, exist_ok=True)
        with open(_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass
