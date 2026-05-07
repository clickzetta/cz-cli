"""Structured JSON audit logging with rotation."""
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional


class AuditLogger:
    """Audit logger with structured JSON format and file rotation."""

    VERSION = "1.0.0"

    def __init__(self, log_path: Path, rotation_size: str = "10MB", retention_days: int = 30):
        self.log_path = Path(log_path)
        self.rotation_size = self._parse_size(rotation_size)
        self.retention_days = retention_days
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.log_path.exists():
            self.log_path.touch(mode=0o600)
        else:
            os.chmod(self.log_path, 0o600)

    def log_execution(
        self,
        event_type: str,
        user: str,
        routing: Dict[str, Any],
        execution: Dict[str, Any],
        result: Dict[str, Any],
        session_id: Optional[str] = None,
        czcode_session_id: Optional[str] = None,
        security: Optional[Dict[str, Any]] = None,
    ) -> str:
        audit_id = str(uuid.uuid4())
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": self.VERSION,
            "audit_id": audit_id,
            "event_type": event_type,
            "user": user,
            "session_id": session_id,
            "czcode_session_id": czcode_session_id,
            "routing": routing,
            "execution": execution,
            "result": result,
            "security": security or {},
        }
        self._write_entry(entry)
        self._rotate_if_needed()
        return audit_id

    def _write_entry(self, entry: Dict[str, Any]) -> None:
        with open(self.log_path, 'a') as f:
            f.write(json.dumps(entry) + '\n')

    def _parse_size(self, size_str: str) -> int:
        size_str = size_str.upper()
        for suffix, mult in [('GB', 1024**3), ('MB', 1024**2), ('KB', 1024)]:
            if size_str.endswith(suffix):
                try:
                    return int(float(size_str[:-len(suffix)]) * mult)
                except ValueError:
                    pass
        try:
            return int(size_str)
        except ValueError:
            return 10 * 1024 * 1024

    def _rotate_if_needed(self) -> None:
        if not self.log_path.exists():
            return
        if self.log_path.stat().st_size >= self.rotation_size:
            ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            self.log_path.rename(self.log_path.with_suffix(f".{ts}.log"))
            self.log_path.touch(mode=0o600)
