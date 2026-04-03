"""Executable entrypoint for python -m cz_cli and PyInstaller."""

from cz_cli.main import cli


if __name__ == "__main__":
    cli()
