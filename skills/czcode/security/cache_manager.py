"""Secure cache manager with SHA256 integrity validation."""
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


class CacheManager:
    """Secure cache manager with fingerprint validation."""

    VERSION = "1.0.0"

    def __init__(self, cache_dir: Path):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        os.chmod(self.cache_dir, 0o700)

    def _validate_key(self, key: str) -> None:
        if not key:
            raise ValueError("Cache key cannot be empty")
        if not re.match(r'^[a-zA-Z0-9_.-]+$', key):
            raise ValueError(f"Invalid cache key: {key}")
        if '..' in key or '/' in key or '\\' in key:
            raise ValueError(f"Invalid cache key: {key}. Path traversal not allowed.")

    def write(self, key: str, data: Any, ttl: int = 86400) -> None:
        self._validate_key(key)
        data_str = json.dumps(data, sort_keys=True)
        fingerprint = hashlib.sha256(data_str.encode()).hexdigest()
        entry = {
            "version": self.VERSION,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": time.time() + ttl,
            "fingerprint": fingerprint,
            "data": data,
        }
        cache_file = self.cache_dir / f"{key}.json"
        with open(cache_file, 'w') as f:
            json.dump(entry, f, indent=2)
        os.chmod(cache_file, 0o600)

    def read(self, key: str) -> Optional[Any]:
        self._validate_key(key)
        cache_file = self.cache_dir / f"{key}.json"
        if not cache_file.exists():
            return None
        try:
            with open(cache_file, 'r') as f:
                entry = json.load(f)
            if entry["expires_at"] <= time.time():
                cache_file.unlink(missing_ok=True)
                return None
            data = entry["data"]
            expected = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
            if entry["fingerprint"] != expected:
                cache_file.unlink(missing_ok=True)
                return None
            return data
        except (json.JSONDecodeError, KeyError, OSError):
            cache_file.unlink(missing_ok=True)
            return None

    def clear(self, key: Optional[str] = None) -> None:
        if key:
            self._validate_key(key)
            (self.cache_dir / f"{key}.json").unlink(missing_ok=True)
        else:
            for f in self.cache_dir.glob("*.json"):
                f.unlink(missing_ok=True)
