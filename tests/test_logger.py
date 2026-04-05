"""Unit tests for logger.py"""

import json

import pytest

import cz_cli.logger as logger_module
from cz_cli.logger import log_operation, _redact_sql


@pytest.fixture(autouse=True)
def _isolate_log_file(monkeypatch, tmp_path):
    log_dir = tmp_path / ".clickzetta"
    log_file = log_dir / "sql-history.jsonl"
    monkeypatch.setattr(logger_module, "_LOG_DIR", log_dir)
    monkeypatch.setattr(logger_module, "_LOG_FILE", log_file)
    return log_file


def test_redact_sql_phone():
    """Test phone number redaction."""
    sql = "INSERT INTO users (phone) VALUES ('13812345678')"
    redacted = _redact_sql(sql)
    assert "138****5678" in redacted
    assert "13812345678" not in redacted


def test_redact_sql_email():
    """Test email redaction."""
    sql = "INSERT INTO users (email) VALUES ('user@example.com')"
    redacted = _redact_sql(sql)
    assert "u***@example.com" in redacted
    assert "user@example.com" not in redacted


def test_redact_sql_password():
    """Test password redaction."""
    sql = "INSERT INTO users (password) VALUES ('secret123')"
    redacted = _redact_sql(sql)
    assert "******" in redacted
    assert "secret123" not in redacted


def test_redact_sql_idcard():
    """Test ID card redaction."""
    sql = "INSERT INTO users (id_card) VALUES ('110101199001011234')"
    redacted = _redact_sql(sql)
    # 18-digit ID card: keep first 3 and last 4, mask middle 11 digits
    assert "110***********1234" in redacted
    assert "110101199001011234" not in redacted


def test_redact_sql_no_sensitive_data():
    """Test SQL without sensitive data."""
    sql = "SELECT * FROM users WHERE age > 18"
    redacted = _redact_sql(sql)
    assert redacted == sql


def test_log_operation_creates_file():
    """Test that log_operation creates log file."""
    log_file = logger_module._LOG_FILE

    # Log an operation
    log_operation("test", sql="SELECT 1", ok=True, rows=1, time_ms=100)

    # Check file exists
    assert log_file.exists()

    # Read last line
    with open(log_file, "r", encoding="utf-8") as f:
        lines = f.readlines()
        last_line = lines[-1]
        entry = json.loads(last_line)

        assert entry["command"] == "test"
        assert entry["sql"] == "SELECT 1"
        assert entry["ok"] is True
        assert entry["rows"] == 1
        assert entry["time_ms"] == 100


def test_log_operation_with_error():
    """Test logging operation with error."""
    log_file = logger_module._LOG_FILE

    log_operation("test", sql="INVALID SQL", ok=False, error_code="SQL_ERROR")

    with open(log_file, "r", encoding="utf-8") as f:
        lines = f.readlines()
        last_line = lines[-1]
        entry = json.loads(last_line)

        assert entry["command"] == "test"
        assert entry["ok"] is False
        assert entry["error_code"] == "SQL_ERROR"
