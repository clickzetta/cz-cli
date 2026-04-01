"""Sensitive field masking based on column name patterns."""

from __future__ import annotations

import re
from typing import Any

_PHONE_PATTERNS = re.compile(r"(phone|mobile|tel|cellphone)", re.I)
_EMAIL_PATTERNS = re.compile(r"(email|e_mail)", re.I)
_PASSWORD_PATTERNS = re.compile(r"(password|passwd|secret|api_key|apikey)", re.I)
_IDCARD_PATTERNS = re.compile(r"(id_card|idcard|id_number|identity|ssn|national_id)", re.I)


def _mask_phone(val: str) -> str:
    digits = re.sub(r"\D", "", val)
    if len(digits) >= 7:
        return digits[:3] + "****" + digits[-4:]
    return "****"


def _mask_email(val: str) -> str:
    if "@" in val:
        local, domain = val.rsplit("@", 1)
        if len(local) > 1:
            return local[0] + "***@" + domain
        return "***@" + domain
    return "******"


def _mask_password(_val: str) -> str:
    return "******"


def _mask_idcard(val: str) -> str:
    if len(val) >= 6:
        return val[:3] + "*" * (len(val) - 7) + val[-4:]
    return "****"


def _get_masker(column_name: str):
    """Return the masking function for a column name, or None."""
    if _PASSWORD_PATTERNS.search(column_name):
        return _mask_password
    if _PHONE_PATTERNS.search(column_name):
        return _mask_phone
    if _EMAIL_PATTERNS.search(column_name):
        return _mask_email
    if _IDCARD_PATTERNS.search(column_name):
        return _mask_idcard
    return None


def mask_rows(columns: list[str], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Apply masking to sensitive columns in-place and return the rows."""
    maskers: dict[str, Any] = {}
    for col in columns:
        fn = _get_masker(col)
        if fn:
            maskers[col] = fn

    if not maskers:
        return rows

    for row in rows:
        for col, fn in maskers.items():
            val = row.get(col)
            if val is not None and isinstance(val, str):
                row[col] = fn(val)
    return rows
