import * as p from "@clack/prompts"
import { splitEndpoint } from "../commands/account-login.js"

/**
 * OAuth login target resolution — DELIBERATELY independent of any profile.
 *
 * `login` is the act of acquiring an identity; a profile is its PRODUCT. Reading
 * a profile's `service` to decide where to log in is a chicken-and-egg bug: it
 * lets a stale profile silently drag a fresh login into the wrong environment
 * (e.g. a default profile pointing at `uat-api.clickzetta.com` makes `login`
 * open the UAT sign-in page). So nothing here consults profiles or
 * `resolveConnectionConfig`.
 *
 * Two ways to name the entry, no magic in between:
 *   - `--partition cn|intl`  → the fixed prod central hosts we own and vouch for.
 *   - `--oauth-url <url>`    → an escape hatch for internal envs / custom domains,
 *                              used VERBATIM. The caller knows their own OAuth
 *                              host; we do not rewrite it (no region stripping,
 *                              no path guessing). If they pass a host that does
 *                              not serve OAuth, it fails loudly — we don't try to
 *                              "fix" their input.
 *
 * The region-specific business service is discovered AFTER login from userinfo
 * (gatewayMapping), never derived here.
 */

/** Customer-facing partitions. The only choice a normal user makes. */
export type Partition = "cn" | "intl"

const PARTITION_ROOT: Record<Partition, string> = {
  cn: "clickzetta.com",
  intl: "singdata.com",
}

export interface LoginTarget {
  /** OAuth entry host (no protocol). From a partition's prod host or --oauth-url verbatim. */
  entryHost: string
  /** Protocol to use for the entry host. */
  protocol: string
}

export interface ResolveLoginTargetArgs {
  /**
   * Explicit OAuth entry URL/host (the --oauth-url flag): internal envs
   * (uat-api…) or custom domains. Used verbatim. Distinct from the business
   * `--service` on purpose — the OAuth entry need not equal the region service
   * SQL calls later run against.
   */
  oauthUrl?: string
  partition?: string
}

/** Prod central host for a customer partition. */
export function partitionEntryHost(partition: Partition): string {
  return `api.${PARTITION_ROOT[partition]}`
}

function isTTY(): boolean {
  return Boolean(process.stdin.isTTY)
}

/**
 * Resolve the OAuth central entry with an explicit, profile-free precedence:
 *   1. --oauth-url                explicit entry (internal envs, custom domains)
 *   2. --partition cn|intl        explicit partition
 *   3. interactive cn/intl choice (TTY only)
 *   4. otherwise                  throw (non-interactive with no target)
 */
export async function resolveLoginTarget(args: ResolveLoginTargetArgs): Promise<LoginTarget> {
  const explicit = args.oauthUrl?.trim()
  if (explicit) {
    // Verbatim: take the host and protocol exactly as given, no rewriting.
    const { host, protocol } = splitEndpoint(explicit)
    return { entryHost: host, protocol }
  }

  const partition = normalizePartition(args.partition)
  if (partition) {
    return { entryHost: partitionEntryHost(partition), protocol: "https" }
  }

  if (isTTY()) {
    const chosen = await p.select({
      message: "Sign in to which region?",
      options: [
        { label: "China (clickzetta.com)", value: "cn" },
        { label: "International (singdata.com)", value: "intl" },
      ],
    })
    if (p.isCancel(chosen)) throw new Error("LOGIN_CANCELLED: sign-in aborted")
    return { entryHost: partitionEntryHost(chosen as Partition), protocol: "https" }
  }

  throw new Error(
    "LOGIN_TARGET_REQUIRED: no login target. Pass --oauth-url <url> or --partition cn|intl (or run interactively).",
  )
}

function normalizePartition(value?: string): Partition | undefined {
  const v = value?.trim().toLowerCase()
  if (v === "cn" || v === "china") return "cn"
  if (v === "intl" || v === "international") return "intl"
  return undefined
}
