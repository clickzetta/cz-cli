import * as vscode from "vscode"

// cz_change: derived from sdks/vscode (upstream opencode's VS Code extension).
// Same shape — host the CLI's TUI in a split terminal and inject @file refs over
// the server's HTTP API — with cz-specific naming, launch command, and the
// port-flag form documented below.
const TERMINAL_NAME = "cz-cli"

// Terminal env key holding the port we told cz-cli to listen on. Read back off
// `terminal.creationOptions.env` in the at-mention command; the two MUST stay in
// sync or file-reference injection degrades to raw sendText with no error.
const PORT_ENV_KEY = "_EXTENSION_CZ_CLI_PORT"

// cz_change: `OPENCODE_CALLER` is deliberately NOT renamed to a CZ_* key.
// packages/opencode/src/ide/index.ts:33 (pristine upstream) hardcodes this exact
// name in alreadyInstalled(); renaming it fails silently rather than erroring.
const CALLER_ENV_KEY = "OPENCODE_CALLER"

// The endpoint that receives file references, and the key we look for in the
// server's OpenAPI document to confirm the listener is really our agent.
const APPEND_PROMPT_PATH = "/tui/append-prompt"

// cz_change: cz-cli's arg scanner (packages/cz-cli/src/run-cli.ts, see
// AGENT_FLAGS_WITH_VALUES) does not know --port takes a value, so the
// space-separated form `agent --port 45995` is read as `agent <subcommand=45995>`,
// fails the AGENT_RUNTIME_SUBCOMMANDS test, and prints help instead of starting
// the server. Verified against the built binary: `--port=N` serves /app, `--port N`
// leaves nothing listening. Always emit the equals form here — it is correct both
// before and after that scanner bug is fixed.
function launchCommand(port: number) {
  return `cz-cli agent --port=${port}`
}

export function activate(context: vscode.ExtensionContext) {
  // Ports we have already confirmed serve our agent. The /doc document is ~470KB,
  // so re-fetching it on every at-mention would be wasteful; a port that answered
  // as the agent once cannot later become a different program without the terminal
  // being closed, which drops the entry along with the terminal.
  const verifiedPorts = new Set<number>()
  const openNewTerminal = vscode.commands.registerCommand("cz.openNewTerminal", async () => {
    await openTerminal()
  })

  const openTerminalCmd = vscode.commands.registerCommand("cz.openTerminal", async () => {
    // A cz-cli terminal already exists => focus it rather than starting a second agent.
    const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
    if (existing) {
      existing.show()
      return
    }
    await openTerminal()
  })

  const addFilepath = vscode.commands.registerCommand("cz.addFilepathToTerminal", async () => {
    const fileRef = getActiveFile()
    if (!fileRef) return

    const terminal = vscode.window.activeTerminal
    if (!terminal || terminal.name !== TERMINAL_NAME) return

    const port = (terminal.creationOptions as vscode.TerminalOptions).env?.[PORT_ENV_KEY]
    if (port) {
      await appendPrompt(Number(port), fileRef)
    } else {
      // Terminal we did not create (or env stripped): fall back to typing the ref.
      terminal.sendText(fileRef, false)
    }
    terminal.show()
  })

  context.subscriptions.push(openNewTerminal, openTerminalCmd, addFilepath)

  async function openTerminal() {
    const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      iconPath: {
        light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
        dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
      },
      location: {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false,
      },
      env: {
        [PORT_ENV_KEY]: port.toString(),
        [CALLER_ENV_KEY]: "vscode",
      },
    })

    terminal.show()
    // Launched through the terminal (not spawn) so PATH resolution goes through the
    // user's shell — that is what finds ~/.local/bin/cz-cli from scripts/setup.sh
    // even when VS Code was started from the Dock without a login shell env.
    terminal.sendText(launchCommand(port))

    const fileRef = getActiveFile()
    if (!fileRef) return

    // Poll until the embedded server answers. Measured ~0.9-1.1s locally for
    // `/app` to respond, so upstream's 10x200ms=2s budget is already marginal;
    // this allows 30s because the only cost of waiting longer is a slower give-up
    // on a machine that is genuinely slow (cold FS cache, loaded CI box, Windows
    // Defender), while giving up early silently drops the file reference.
    if (await waitForServer(port)) {
      await appendPrompt(port, `In ${fileRef}`)
      terminal.show()
    }
  }

  // cz_change: the port is picked at random, so before posting anything we must
  // confirm what answers on it is OUR agent. `fetch` only rejects when the
  // connection fails — an HTTP 404 resolves — so upstream's "did fetch throw?"
  // probe treats ANY listener as ready. Verified with an unrelated
  // `python3 -m http.server` on the chosen port: GET /app returned 404, the probe
  // reported ready, and the file path was then POSTed to that foreign service (it
  // answered 501). That leaks the path and, worse, hides the real failure — the
  // port was taken, so cz-cli never bound it.
  //
  // Checking the served OpenAPI document instead: /doc must parse as JSON and must
  // declare the exact endpoint we are about to call. Deliberately keyed on the
  // endpoint rather than on `info.title` (currently "opencode",
  // packages/opencode/src/server/routes/instance/httpapi/public.ts:532) so this
  // survives rebranding and asserts the capability we actually depend on.
  async function isOurAgent(port: number) {
    if (verifiedPorts.has(port)) return true
    const res = await fetch(`http://127.0.0.1:${port}/doc`)
    if (!res.ok) return false
    const doc = (await res.json()) as { paths?: Record<string, unknown> }
    if (!doc.paths || !(APPEND_PROMPT_PATH in doc.paths)) return false
    verifiedPorts.add(port)
    return true
  }

  async function waitForServer(port: number, tries = 60, delayMs = 500) {
    for (let i = 0; i < tries; i++) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      try {
        if (await isOurAgent(port)) return true
        // Something else holds this port, and it will not start answering as the
        // agent later — cz-cli could not have bound it. Stop rather than burn the
        // full budget, and say so: silence here is what made the old behaviour
        // look like "at-mention randomly does not work".
        vscode.window.showWarningMessage(
          `cz-cli: port ${port} is already in use by another program, so the agent could not start its server. ` +
            `Close that program, or run ${TERMINAL_NAME} again to pick a different port.`,
        )
        return false
      } catch {
        // Not listening yet, or a partially-started server: keep polling.
      }
    }
    return false
  }

  // Verifies the listener before sending. This is reached from the at-mention
  // command as well as from session start, and that path has no poll loop in front
  // of it — without the check here, an at-mention on a port held by another program
  // would POST the file path straight to it.
  async function appendPrompt(port: number, text: string) {
    try {
      if (!(await isOurAgent(port))) {
        vscode.window.showWarningMessage(
          `cz-cli: nothing is answering as the agent on port ${port}, so the file reference was not sent.`,
        )
        return
      }
      await fetch(`http://127.0.0.1:${port}${APPEND_PROMPT_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
    } catch (err) {
      vscode.window.showWarningMessage(
        `cz-cli: could not send the file reference to the agent (${err instanceof Error ? err.message : String(err)}).`,
      )
    }
  }

  function getActiveFile() {
    const activeEditor = vscode.window.activeTextEditor
    if (!activeEditor) return

    const document = activeEditor.document
    if (!vscode.workspace.getWorkspaceFolder(document.uri)) return

    let ref = `@${vscode.workspace.asRelativePath(document.uri)}`

    const selection = activeEditor.selection
    if (!selection.isEmpty) {
      // 1-based to match what the agent renders back to the user.
      const start = selection.start.line + 1
      const end = selection.end.line + 1
      ref += start === end ? `#L${start}` : `#L${start}-${end}`
    }

    return ref
  }
}

export function deactivate() {}
