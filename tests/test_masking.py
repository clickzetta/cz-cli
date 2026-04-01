"""Unit tests for masking.py"""

from cz_cli.masking import mask_rows


def test_mask_phone_column():
    """Test phone number masking."""
    columns = ["id", "phone", "name"]
    rows = [
        {"id": 1, "phone": "13812345678", "name": "Alice"},
        {"id": 2, "phone": "13987654321", "name": "Bob"},
    ]

    masked = mask_rows(columns, rows)

    assert masked[0]["phone"] == "138****5678"
    assert masked[1]["phone"] == "139****4321"
    assert masked[0]["name"] == "Alice"  # unchanged


def test_mask_email_column():
    """Test email masking."""
    columns = ["id", "email"]
    rows = [
        {"id": 1, "email": "alice@example.com"},
        {"id": 2, "email": "bob@test.org"},
    ]

    masked = mask_rows(columns, rows)

    assert masked[0]["email"] == "a***@example.com"
    assert masked[1]["email"] == "b***@test.org"


def test_mask_password_column():
    """Test password masking."""
    columns = ["id", "password"]
    rows = [
        {"id": 1, "password": "secret123"},
        {"id": 2, "password": "pass456"},
    ]

    masked = mask_rows(columns, rows)

    assert masked[0]["password"] == "******"
    assert masked[1]["password"] == "******"


def test_mask_idcard_column():
    """Test ID card masking."""
    columns = ["id", "id_card"]
    rows = [
        {"id": 1, "id_card": "110101199001011234"},
        {"id": 2, "id_card": "320102198512125678"},
    ]

    masked = mask_rows(columns, rows)

    # 18-digit ID card: keep first 3 and last 4, mask middle 11 digits
    assert masked[0]["id_card"] == "110***********1234"
    assert masked[1]["id_card"] == "320***********5678"


def test_mask_multiple_sensitive_columns():
    """Test masking multiple sensitive columns."""
    columns = ["id", "phone", "email", "password"]
    rows = [
        {
            "id": 1,
            "phone": "13812345678",
            "email": "user@example.com",
            "password": "secret",
        }
    ]

    masked = mask_rows(columns, rows)

    assert masked[0]["phone"] == "138****5678"
    assert masked[0]["email"] == "u***@example.com"
    assert masked[0]["password"] == "******"
    assert masked[0]["id"] == 1  # unchanged


def test_mask_no_sensitive_columns():
    """Test masking with no sensitive columns."""
    columns = ["id", "name", "age"]
    rows = [
        {"id": 1, "name": "Alice", "age": 30},
        {"id": 2, "name": "Bob", "age": 25},
    ]

    masked = mask_rows(columns, rows)

    # Should be unchanged
    assert masked == rows


def test_mask_null_values():
    """Test masking with null values."""
    columns = ["id", "phone"]
    rows = [
        {"id": 1, "phone": None},
        {"id": 2, "phone": "13812345678"},
    ]

    masked = mask_rows(columns, rows)

    assert masked[0]["phone"] is None
    assert masked[1]["phone"] == "138****5678"


def test_mask_case_insensitive():
    """Test that column name matching is case-insensitive."""
    columns = ["id", "PHONE", "Email", "PassWord"]
    rows = [
        {
            "id": 1,
            "PHONE": "13812345678",
            "Email": "user@example.com",
            "PassWord": "secret",
        }
    ]

    masked = mask_rows(columns, rows)

    assert masked[0]["PHONE"] == "138****5678"
    assert masked[0]["Email"] == "u***@example.com"
    assert masked[0]["PassWord"] == "******"
