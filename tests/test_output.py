"""Unit tests for output.py"""

import json

from cz_cli.output import Timer, _json_dumps


def test_timer_context_manager():
    """Test Timer context manager."""
    import time

    timer = Timer()
    with timer:
        time.sleep(0.1)

    assert timer.elapsed_ms >= 100
    assert timer.elapsed_ms < 200  # Should be around 100ms


def test_json_dumps_basic():
    """Test JSON serialization."""
    data = {"key": "value", "number": 123}
    result = _json_dumps(data)

    assert json.loads(result) == data


def test_json_dumps_with_datetime():
    """Test JSON serialization with datetime."""
    from datetime import datetime

    data = {"timestamp": datetime(2024, 1, 1, 12, 0, 0)}
    result = _json_dumps(data)

    # Should convert datetime to string
    parsed = json.loads(result)
    assert "2024-01-01" in parsed["timestamp"]


def test_json_dumps_chinese_characters():
    """Test JSON serialization with Chinese characters."""
    data = {"name": "测试"}
    result = _json_dumps(data)

    # Should preserve Chinese characters (ensure_ascii=False)
    assert "测试" in result
    assert "\\u" not in result  # No unicode escaping
