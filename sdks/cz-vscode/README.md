# ClickZetta CLI for VS Code

Runs the `cz-cli agent` TUI in a split terminal next to your code, and sends file
references into it from the editor.

This is an internal build. It is distributed as a `.vsix` from CI artifacts and
GitHub Releases, **not** through the VS Code Marketplace — see [Install](#install).

## Prerequisites

`cz-cli` must be installed and on your `PATH`:

```sh
cz-cli --version
```

If that fails, install cz-cli first. The extension launches it through a terminal,
so it resolves `PATH` the same way your shell does (including `~/.local/bin`).

You also need a configured profile and LLM — the extension does not set those up:

```sh
cz-cli auth login <name>
cz-cli agent llm show
```

## Install

Download `cz-cli-vscode-<version>.vsix`, then either:

```sh
code --install-extension cz-cli-vscode-0.1.0.vsix
```

or in VS Code: `Cmd+Shift+P` → **Extensions: Install from VSIX...**

Where to get the vsix:

- **Released versions (recommended)** — attached to every release, stable and dev,
  on the [Releases page](https://github.com/clickzetta/cz-cli/releases). Direct
  download, no login, no unzipping:

  ```sh
  gh release download <tag> --pattern '*.vsix' --repo clickzetta/cz-cli
  ```

  Stable tags produce `cz-cli-vscode-<version>.vsix`; dev tags produce
  `cz-cli-vscode-<version>-dev.<timestamp>.vsix`.

- **Per-commit builds** — the `vscode-extension` artifact on a
  [build-vscode-extension run](https://github.com/clickzetta/cz-cli/actions/workflows/build-vscode-extension.yml).
  Only runs when the extension itself changes. Artifacts are zipped, so unzip
  first, and they expire after 30 days.

CI builds are versioned `0.1.0-dev.<run>.<sha>` so you can tell which commit you
are running (`code --list-extensions --show-versions`).

> **No auto-update.** VS Code does not check for updates on extensions installed
> from a vsix. To upgrade, download the newer vsix and install it again. Watch the
> repo releases if you want to know when there is a new one.
>
> Note that VS Code refuses to "downgrade", and it compares versions
> semver-style — so `0.1.0-dev.42.abc1234` counts as *older* than a plain `0.1.0`.
> When moving between dev builds, or from a release back to a dev build, add
> `--force`:
>
> ```sh
> code --install-extension cz-cli-vscode-0.1.0-dev.42.abc1234.vsix --force
> ```

## Features

| Shortcut | Action |
| --- | --- |
| `Cmd+Esc` / `Ctrl+Esc` | Open the agent in a split terminal, or focus the existing one |
| `Cmd+Shift+Esc` / `Ctrl+Shift+Esc` | Start a second agent session in a new terminal |
| `Cmd+Alt+K` / `Ctrl+Alt+K` | Insert the active file (and selection) as `@path#L12-20` |

There is also an editor title-bar button for starting a new session.

When you open the agent with a file already active, the extension waits for the
agent to finish booting and then seeds the prompt with `In @<file>`.

## Known limitations

- **The UI is the terminal TUI.** You get the agent hosted in VS Code's terminal
  panel, not a native sidebar — no native diff review, permission dialogs, or
  session list. A native surface would need a different architecture (ACP).
- **The seeded file reference lands about a second after the terminal opens.** The
  TUI paints in ~0.3s but its HTTP server answers at ~0.9-1.1s, so `In @<file>` can
  appear shortly after you start typing. The extension waits up to 30s, then gives
  up. `Cmd+Alt+K` works normally once the agent is up.
- **If the chosen port is already taken**, the agent cannot start its server and the
  extension says so instead of sending the file reference anywhere. Run the command
  again to get a different port.
- **The agent's local HTTP server is unauthenticated.** Any process running as you
  can post to `http://127.0.0.1:<port>/tui/append-prompt` and inject text into your
  session. This matches upstream behaviour and is not something the extension can
  currently fix: setting `OPENCODE_SERVER_PASSWORD` makes the TUI's own client fail
  with `401`. Relevant on shared or multi-user machines.

## Development

```sh
code sdks/cz-vscode   # open THIS directory, not the repo root
bun install
```

Press `F5` to launch a VS Code window with the extension loaded. `tsc` and
`esbuild` watchers run automatically; after a change, `Cmd+Shift+P` →
**Developer: Reload Window**.

Build a vsix locally:

```sh
bun install -g @vscode/vsce
cd sdks/cz-vscode && ./script/package
```

Derived from `sdks/vscode` (upstream opencode's extension). See `src/extension.ts`
for the cz-specific deltas, each marked `cz_change`.
