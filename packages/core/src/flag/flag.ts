import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("OPENCODE_EXPERIMENTAL") : truthy(key)
}

//======================== cz-cli change ========================
// Every env-backed flag is read at ACCESS time, not at module load.
//
// Upstream had it both ways: 8 entries were already getters, carrying the comment
// "Evaluated at access time (not module load) because tests, the CLI, and external
// tooling set these env vars at runtime" — and the other 26 were plain properties,
// i.e. a snapshot taken the first time this module is imported. Which half a given
// variable landed in was historical accident, not a decision.
//
// That split is unobservable until someone sets an env var after import, and then it
// fails silently. cz-cli does exactly that: it configures opencode from
// bootstrap/opencode-injection.ts inside main(), by which point the module graph is
// loaded (bootstrap/runtime.ts statically imports an opencode module). So
// OPENCODE_CONFIG / OPENCODE_CONFIG_CONTENT landed in process.env while `Flag.*`
// stayed undefined forever, and opencode's config loader — which reads
// `Flag.OPENCODE_CONFIG` — never loaded llm.json. Symptoms, all from one cause:
// `agent llm models <entry>` reported MODEL_DISCOVERY_FAILED for a healthy gateway
// entry, `agent llm show` resolved its default model against a provider set with zero
// llm.json entries, and `agent run --model <entry>/<id>` answered "Model not found".
// The TUI was unaffected only because its server runs in a Bun Worker, whose fresh
// module registry re-evaluates this file after the env is already set.
//
// opencode itself has the same exposure (provider/provider.ts assigns
// process.env.AWS_BEARER_TOKEN_BEDROCK at runtime), so this is not a cz-specific need.
// Making the reads lazy is the root fix and it is upstream's own established pattern —
// no new mechanism, and no ordering discipline required of any caller.
//
// Setters exist for every flag that some caller assigns to as a mutable slot —
// upstream tests do this for OPENCODE_SERVER_PASSWORD / OPENCODE_SERVER_USERNAME /
// OPENCODE_EXPERIMENTAL_WORKSPACES / OPENCODE_WORKSPACE_ID / OPENCODE_DB /
// OPENCODE_MODELS_PATH / OPENCODE_DISABLE_MODELS_FETCH. They write through to
// process.env so the getter stays the single source of truth. Getter-only would turn
// those assignments into "Attempted to assign to readonly property" at runtime, which
// is how the first version of this patch broke httpapi-listen.test.ts. The check in
// cz-cli's test/flag-injection-visibility.test.ts scans the tree for `Flag.X =` and
// fails if any assigned flag lacks a setter, so a new assignment upstream cannot land
// silently.
//
// The two Config.* entries are Effect Configs, already resolved at runtime, so they
// are left exactly as upstream had them.
export const Flag = {
  get OTEL_EXPORTER_OTLP_ENDPOINT() {
    return process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]
  },
  get OTEL_EXPORTER_OTLP_HEADERS() {
    return process.env["OTEL_EXPORTER_OTLP_HEADERS"]
  },

  get OPENCODE_AUTO_HEAP_SNAPSHOT() {
    return truthy("OPENCODE_AUTO_HEAP_SNAPSHOT")
  },
  get OPENCODE_GIT_BASH_PATH() {
    return process.env["OPENCODE_GIT_BASH_PATH"]
  },
  get OPENCODE_CONFIG() {
    return process.env["OPENCODE_CONFIG"]
  },
  get OPENCODE_CONFIG_CONTENT() {
    return process.env["OPENCODE_CONFIG_CONTENT"]
  },
  get OPENCODE_DISABLE_AUTOUPDATE() {
    return truthy("OPENCODE_DISABLE_AUTOUPDATE")
  },
  get OPENCODE_ALWAYS_NOTIFY_UPDATE() {
    return truthy("OPENCODE_ALWAYS_NOTIFY_UPDATE")
  },
  get OPENCODE_DISABLE_PRUNE() {
    return truthy("OPENCODE_DISABLE_PRUNE")
  },
  get OPENCODE_DISABLE_TERMINAL_TITLE() {
    return truthy("OPENCODE_DISABLE_TERMINAL_TITLE")
  },
  get OPENCODE_SHOW_TTFD() {
    return truthy("OPENCODE_SHOW_TTFD")
  },
  get OPENCODE_DISABLE_AUTOCOMPACT() {
    return truthy("OPENCODE_DISABLE_AUTOCOMPACT")
  },
  get OPENCODE_DISABLE_MODELS_FETCH() {
    return truthy("OPENCODE_DISABLE_MODELS_FETCH")
  },
  set OPENCODE_DISABLE_MODELS_FETCH(value: boolean) {
    process.env["OPENCODE_DISABLE_MODELS_FETCH"] = value ? "true" : "false"
  },
  get OPENCODE_DISABLE_MOUSE() {
    return truthy("OPENCODE_DISABLE_MOUSE")
  },
  get OPENCODE_FAKE_VCS() {
    return process.env["OPENCODE_FAKE_VCS"]
  },
  get OPENCODE_SERVER_PASSWORD() {
    return process.env["OPENCODE_SERVER_PASSWORD"]
  },
  set OPENCODE_SERVER_PASSWORD(value: string | undefined) {
    if (value === undefined) delete process.env["OPENCODE_SERVER_PASSWORD"]
    else process.env["OPENCODE_SERVER_PASSWORD"] = value
  },
  get OPENCODE_SERVER_USERNAME() {
    return process.env["OPENCODE_SERVER_USERNAME"]
  },
  set OPENCODE_SERVER_USERNAME(value: string | undefined) {
    if (value === undefined) delete process.env["OPENCODE_SERVER_USERNAME"]
    else process.env["OPENCODE_SERVER_USERNAME"] = value
  },
  get OPENCODE_DISABLE_FFF() {
    return process.env["OPENCODE_DISABLE_FFF"] === undefined
      ? process.platform === "win32"
      : truthy("OPENCODE_DISABLE_FFF")
  },

  // Experimental
  OPENCODE_EXPERIMENTAL_FILEWATCHER: Config.boolean("OPENCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  get OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT() {
    return process.env["OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"] === undefined
      ? process.platform === "win32"
      : truthy("OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  },
  get OPENCODE_MODELS_URL() {
    return process.env["OPENCODE_MODELS_URL"]
  },
  get OPENCODE_MODELS_PATH() {
    return process.env["OPENCODE_MODELS_PATH"]
  },
  set OPENCODE_MODELS_PATH(value: string | undefined) {
    if (value === undefined) delete process.env["OPENCODE_MODELS_PATH"]
    else process.env["OPENCODE_MODELS_PATH"] = value
  },
  get OPENCODE_DB() {
    return process.env["OPENCODE_DB"]
  },
  set OPENCODE_DB(value: string | undefined) {
    if (value === undefined) delete process.env["OPENCODE_DB"]
    else process.env["OPENCODE_DB"] = value
  },

  // Opt-in: include the real error and cause in the 500 body that the defect
  // boundary produces (server/.../middleware/error.ts), instead of only a ref that
  // points at the log file. Off by default because that boundary also answers
  // network clients; cz-cli turns it on for `mcp serve`, whose only client is the
  // local agent talking to a loopback server it started itself.
  get OPENCODE_ERROR_DETAIL() {
    return truthy("OPENCODE_ERROR_DETAIL")
  },
  get OPENCODE_WORKSPACE_ID() {
    return process.env["OPENCODE_WORKSPACE_ID"]
  },
  set OPENCODE_WORKSPACE_ID(value: string | undefined) {
    if (value === undefined) delete process.env["OPENCODE_WORKSPACE_ID"]
    else process.env["OPENCODE_WORKSPACE_ID"] = value
  },
  get OPENCODE_EXPERIMENTAL_WORKSPACES() {
    return enabledByExperimental("OPENCODE_EXPERIMENTAL_WORKSPACES")
  },
  set OPENCODE_EXPERIMENTAL_WORKSPACES(value: boolean) {
    process.env["OPENCODE_EXPERIMENTAL_WORKSPACES"] = value ? "true" : "false"
  },
  //====================== end cz-cli change ======================

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get OPENCODE_DISABLE_PROJECT_CONFIG() {
    return truthy("OPENCODE_DISABLE_PROJECT_CONFIG")
  },
  get OPENCODE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("OPENCODE_EXPERIMENTAL_REFERENCES")
  },
  get OPENCODE_TUI_CONFIG() {
    return process.env["OPENCODE_TUI_CONFIG"]
  },
  get OPENCODE_CONFIG_DIR() {
    return process.env["OPENCODE_CONFIG_DIR"]
  },
  get OPENCODE_PURE() {
    return truthy("OPENCODE_PURE")
  },
  get OPENCODE_PERMISSION() {
    return process.env["OPENCODE_PERMISSION"]
  },
  get OPENCODE_PLUGIN_META_FILE() {
    return process.env["OPENCODE_PLUGIN_META_FILE"]
  },
  get OPENCODE_CLIENT() {
    return process.env["OPENCODE_CLIENT"] ?? "cli"
  },
}
