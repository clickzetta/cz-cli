"""Python example for invoking cz-cli with Personal Access Token (PAT) authentication.

Required environment variables:
  CZ_PAT        Personal Access Token (generate from ClickZetta console)
  CZ_SERVICE    Service endpoint (e.g. uat-api.clickzetta.com)
  CZ_INSTANCE   Instance ID
  CZ_WORKSPACE  Workspace name

Optional environment variables:
  CZ_PROTOCOL   defaults to "https"
  CZ_SCHEMA     default schema
  CZ_VCLUSTER   virtual cluster
  CZ_CLI_BIN    defaults to "cz-cli"
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ConnectionConfig:
    """Connection configuration using PAT (token) authentication."""

    pat: str
    service: str
    instance: str
    workspace: str
    protocol: str = "https"
    schema: str | None = None
    vcluster: str | None = None

    def to_args(self) -> list[str]:
        args = [
            "--pat", self.pat,
            "--service", self.service,
            "--instance", self.instance,
            "--workspace", self.workspace,
            "--protocol", self.protocol,
        ]
        if self.schema:
            args += ["--schema", self.schema]
        if self.vcluster:
            args += ["--vcluster", self.vcluster]
        return args


class CzCliError(RuntimeError):
    """Raised when cz-cli returns a non-zero exit code or unparseable output."""

    def __init__(self, message: str, returncode: int = 1, stderr: str = ""):
        super().__init__(message)
        self.returncode = returncode
        self.stderr = stderr


class CzCliClient:
    def __init__(
        self,
        config: ConnectionConfig,
        *,
        binary: str = "cz-cli",
        timeout_seconds: int = 120,
    ) -> None:
        self.config = config
        self.binary = binary
        self.timeout_seconds = timeout_seconds

    def run(self, *args: str, format: str = "json") -> dict[str, Any]:
        """Execute a cz-cli command and return parsed JSON output."""
        cmd = [self.binary, *self.config.to_args(), "--format", format, *args]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=self.timeout_seconds,
            check=False,
        )
        if result.returncode != 0:
            msg = result.stderr.strip() or result.stdout.strip() or f"exit code {result.returncode}"
            raise CzCliError(msg, result.returncode, result.stderr)

        # cz-cli may emit non-JSON text before the JSON payload (e.g. auto-update logs).
        # Extract the first valid JSON object from stdout.
        stdout = result.stdout
        json_start = stdout.find("{")
        if json_start == -1:
            raise CzCliError(f"No JSON found in output:\n{stdout[:500]}")
        try:
            return json.loads(stdout[json_start:])
        except json.JSONDecodeError as exc:
            raise CzCliError(f"Failed to parse JSON: {exc}\nRaw output: {stdout[:500]}") from exc

    # --- Connection & metadata ---

    def status(self) -> dict[str, Any]:
        """Check connection status and current profile info."""
        return self.run("status")

    def list_schemas(self, like: str | None = None) -> list[dict[str, Any]]:
        """List all schemas in the current workspace."""
        args = ["schema", "list"]
        if like:
            args += ["--like", like]
        return self.run(*args).get("data", [])

    def list_tables(self, schema: str | None = None, like: str | None = None) -> list[dict[str, Any]]:
        """List tables, optionally filtered by schema and pattern."""
        args = ["table", "list"]
        if schema:
            args += ["--schema", schema]
        if like:
            args += ["--like", like]
        return self.run(*args).get("data", [])

    # --- SQL execution ---

    def sql(self, statement: str) -> dict[str, Any]:
        """Execute a SQL statement and return results."""
        return self.run("sql", statement)

    def sql_to_rows(self, statement: str) -> list[dict[str, Any]]:
        """Execute SQL and return rows as list of dicts."""
        result = self.sql(statement)
        columns = result.get("columns", [])
        return [dict(zip(columns, row)) for row in result.get("rows", [])]

    # --- Studio tasks ---

    def list_tasks(self) -> list[dict[str, Any]]:
        """List Studio scheduled tasks."""
        return self.run("task", "list").get("data", [])

    def list_runs(self, task_name: str | None = None, limit: int = 10) -> list[dict[str, Any]]:
        """List recent task runs."""
        args = ["runs", "list", "--limit", str(limit)]
        if task_name:
            args += ["--task", task_name]
        return self.run(*args).get("data", [])

    # --- AI Agent ---

    def agent_run(self, prompt: str, *, session: str | None = None) -> dict[str, Any]:
        """Run AI agent with a natural-language prompt."""
        args = ["agent", "run", prompt]
        if session:
            args += ["--session", session]
        return self.run(*args)


def load_config_from_env() -> ConnectionConfig:
    """Load token-based connection config from environment variables."""
    pat = os.environ.get("CZ_PAT")
    if not pat:
        sys.exit("Error: CZ_PAT environment variable is required. "
                 "Generate a Personal Access Token from ClickZetta console.")
    return ConnectionConfig(
        pat=pat,
        service=os.environ.get("CZ_SERVICE", ""),
        instance=os.environ.get("CZ_INSTANCE", ""),
        workspace=os.environ.get("CZ_WORKSPACE", ""),
        protocol=os.environ.get("CZ_PROTOCOL", "https"),
        schema=os.environ.get("CZ_SCHEMA"),
        vcluster=os.environ.get("CZ_VCLUSTER"),
    )


def main() -> None:
    client = CzCliClient(
        load_config_from_env(),
        binary=os.environ.get("CZ_CLI_BIN", "cz-cli"),
    )

    # 1. Verify connection
    print("=== Connection Status ===")
    status = client.status()
    print(json.dumps(status, indent=2, ensure_ascii=False))

    # 2. List schemas
    print("\n=== Schemas ===")
    schemas = client.list_schemas()
    for s in schemas:
        print(f"  {s.get('name')}")

    # 3. List tables
    print("\n=== Tables ===")
    tables = client.list_tables()
    for t in tables[:20]:
        print(f"  {t.get('name')}")

    # 4. Run SQL queries
    print("\n=== SQL: basic query ===")
    rows = client.sql_to_rows("SELECT 1 AS ok, 'hello' AS greeting")
    for r in rows:
        print(f"  {r}")

    # 5. Multi-row query
    print("\n=== SQL: generate series ===")
    rows = client.sql_to_rows("SELECT id, id * 10 AS value FROM (SELECT 1 AS id UNION ALL SELECT 2 UNION ALL SELECT 3)")
    for r in rows:
        print(f"  id={r.get('id')}, value={r.get('value')}")

    # 6. Studio tasks
    print("\n=== Studio Tasks ===")
    try:
        tasks = client.list_tasks()
        for t in tasks[:10]:
            print(f"  {t.get('task_name', t)}")
    except CzCliError as e:
        print(f"  (skipped: {e})")

    # 7. AI Agent (note: agent subcommand uses profile-based auth)
    print("\n=== AI Agent ===")
    print("  (agent run requires a configured profile; see `cz-cli agent run --help`)")


if __name__ == "__main__":
    main()
