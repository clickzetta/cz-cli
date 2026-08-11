# Review context for cz-cli

Read this before reviewing. It records conventions that are not obvious from a
diff, and the things that look like bugs here but are not.

## What this repo is

A Bun + TypeScript monorepo under `packages/`. It is a fork of upstream
opencode: most packages are upstream code carried forward, while the
ClickZetta-specific work lives in `packages/cz-cli`,
`packages/clickzetta-sdk`, and `packages/clickzetta-ai-gateway`.

`AGENTS.md` at the repo root is inherited from upstream and still says the
default branch is `dev` — that line is wrong for this fork; ignore it. The rest
of `AGENTS.md` (the Style Guide section) does apply, so read it when a change
looks stylistically unusual.

## Cross-package imports — raise as a question, not a violation

This branch's `AGENTS.md` does not document a dependency-direction rule, so do
not assert one. What is still worth surfacing: a change that introduces a **new
dependency edge between two packages** that did not previously import each
other. Say which edge is new and ask the author to confirm it is intended.
Do not label it a layering violation.

## Do not report these

- **Generated code.** `packages/*/src/generated` and `src/generated-effect` are
  produced by `bun run generate` from `packages/client`. They are excluded from
  review by the workflow's path filter; if one slips through, do not comment on
  its style or structure.
- **Missing `try`/`catch`.** This codebase deliberately avoids `try`/`catch`.
  Only report a missing catch when an actual unhandled rejection or crash path
  follows from it, not as a defensive-coding suggestion.
- **`let` over `const`, or minor nesting.** Style only. Skip it.
- **Absent type annotations.** The codebase relies on inference on purpose;
  explicit annotations are expected only on exports or where clarity demands.
- **`for` loops rewritten as `map`/`filter`.** A preference, not a defect.
- **Upstream code you were not asked about.** If a PR touches one line in an
  upstream package, review that line and its blast radius — do not audit the
  surrounding upstream file.

## Worth extra attention in this repo

- **Credentials in telemetry.** Command arguments are recorded to OTel. Any new
  flag or positional argument that can carry a password, PAT, or cookie is a
  finding — plaintext credentials have reached `_positional` before.
- **`process.exit()` paths.** Early exits skip telemetry flushing and cleanup.
  A new `process.exit()` in a command path is worth flagging.
- **Auth header construction.** Profile-based auth (PAT, password, OAuth,
  cookie) is deliberately independent per method. Code that shares or injects
  parameters across those four paths has broken things before.
- **Spawned processes.** Interpolating user-supplied values into a shell command
  string instead of passing an argument array.

## Commit and PR titles

Conventional style: `type(scope): summary`, with type one of `feat`, `fix`,
`docs`, `chore`, `refactor`, `test`. Scope is the affected package or area.
