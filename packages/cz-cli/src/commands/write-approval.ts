import type { GlobalArgs } from "../cli.js"
import { error } from "../output/index.js"

export const writeOption = {
  type: "boolean" as const,
  default: false,
  describe: "Allow this operation only after explicit user approval; first run without --write.",
}

export function requireWriteApproval(
  argv: Pick<GlobalArgs, "format"> & { write?: boolean },
  details: { reason?: string; code?: string; message?: string; query_kind?: "write" | "unknown"; statement_index?: number },
) {
  if (argv.write) return true
  const code = details.code ?? "WRITE_NOT_ALLOWED"
  const message = details.message ?? "Write operation requires explicit user approval."
  const remediation = "Ask the user to approve the operation and its target. Wait for explicit approval, then re-run the same command with --write. Do not add --write automatically or use another command to bypass this check."
  error(code, `${message} ${remediation}`, {
    format: argv.format,
    aiMessage: remediation,
    extra: {
      ...details,
      status: "action_required",
      query_kind: details.query_kind ?? "write",
      message,
      issues: [{ code, message, remediation }],
      next_steps: [
        "Show the user the operation, target profile/workspace/schema or path, and the reported reason, then ask for approval.",
        "Wait for explicit user approval; do not retry while approval is pending.",
        "After approval, re-run the same command with --write, preserving the operation, target, variables, and settings. Re-check and obtain approval again if the operation changes.",
      ],
    },
  })
  return false
}
