"""Tests for --output/-o option on subcommands."""

from click.testing import CliRunner

from cz_cli.main import cli


def _runner():
    return CliRunner()


def test_global_minus_f_rejected():
    """Global -f json should be rejected (not a recognized option)."""
    runner = _runner()
    result = runner.invoke(cli, ["-f", "json", "status"])
    assert result.exit_code != 0
    assert "Error" in result.output or "no such option" in result.output


def test_global_minus_o_still_works():
    """Global -o json should work before subcommand."""
    runner = _runner()
    result = runner.invoke(cli, ["-o", "json", "profile", "list"])
    # May fail on connection, but should not fail on option parsing
    assert "no such option" not in result.output


def test_subcommand_minus_o_works():
    """-o should work after subcommand name (e.g., table list -o json)."""
    runner = _runner()
    result = runner.invoke(cli, ["profile", "list", "-o", "json"])
    # Option should be recognized even if command fails on connection
    assert "no such option" not in result.output


def test_nested_group_command_has_output_option():
    """Nested group commands (e.g., table list) should get --output/-o via CLIGroup."""
    runner = _runner()
    result = runner.invoke(cli, ["table", "list", "--help"])
    assert "--output" in result.output or "-o" in result.output


def test_subcommand_output_overrides_global():
    """Subcommand -o should override global --output."""
    runner = _runner()
    # profile list reads format; we can't test the resolved value easily
    # without a DB, but we can verify both options are accepted together
    result = runner.invoke(cli, ["-o", "json", "profile", "list", "-o", "table"])
    assert "no such option" not in result.output


def test_sql_minus_f_still_means_file():
    """sql -f should still mean --file, not --format."""
    runner = _runner()
    result = runner.invoke(cli, ["sql", "--help"])
    # -f should appear with --file, not --output/format
    assert "--file" in result.output
    # Verify -f is associated with --file
    assert "-f" in result.output
