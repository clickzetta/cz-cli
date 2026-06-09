- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `main`.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.
- When making git commits, always append the following co-author trailer (as a separate `-m` paragraph):
  `Co-Authored-By: cz-cli <noreply@clickzetta.com>`

## Development Workflow: TDD + OpenSpec

This project uses **spec-driven development** (OpenSpec) with TDD. **This is mandatory — do not skip any step.**

### Step-by-step (follow in order, no exceptions)

1. **Read `openspec/config.yaml`** — it lists which spec covers which area of the codebase.
2. **Identify the relevant spec** from the "Spec coverage" map in `openspec/config.yaml`:
   - If the area you are changing is listed → read that spec file before writing any code.
   - If the area is listed under "Areas NOT yet covered" → you MUST create a new spec first.
   - If you are unsure → treat it as uncovered and create a spec.
3. **Update or create the spec** (`openspec/specs/<topic>/spec.md`) to reflect the new or changed behavior. Use 中文, WHEN/THEN scenario format.
4. **Write or update tests** that verify the new spec scenarios.
5. **Implement** the code change to pass the tests and satisfy the spec.
6. **Commit spec + tests + code together** in one commit. Never commit code without a corresponding spec update.

### What counts as a "behavior change" requiring a spec update

- Any change to install/update/postinstall logic
- Any change to how binaries are placed, signed, or permissions are set
- Any change to GitHub Actions build or release steps
- Any change to version resolution, channel selection, or auto-update logic
- Any new CLI command or flag

### What does NOT require a spec update

- Pure refactors with no observable behavior change
- Typo fixes, comment updates, log message wording
- Test-only changes that add coverage for existing spec scenarios

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Verification (mandatory — no exceptions)

**Never claim a fix works without running it.** Presenting analysis as a conclusion is not acceptable.

### After every code change

1. **Run the relevant tests**: `cd packages/opencode && bun test <test-file>` (or the closest test covering the changed code).
2. **Run typecheck**: `bun typecheck` from the affected package directory.
3. **Smoke-test the binary path if the change touches install/update/CLI logic**:
   - Build a local binary: `cd packages/opencode && bun run script/build.ts --single`
   - Execute the affected command directly: e.g. `dist/cz-cli-darwin-arm64/bin/cz-cli --version`
4. **For shell script changes** (`install.sh`, `setup.sh`): run `bash -n scripts/install.sh` (syntax check) and test the specific function in isolation with `bash -x`.
5. **For macOS signing/quarantine changes**: verify with `codesign -dvv <binary>` and `xattr -l <binary>` after install.

### Debugging failures

- **Do not guess the root cause** from source reading alone. Run the code and capture actual output.
- Use `bash -x script.sh` or add `set -x` to isolate shell script failures.
- For TypeScript runtime errors, run with `--inspect` or add temporary `console.error` to capture the actual execution path.
- For binary/Gatekeeper issues: `spctl -a -v <binary>` shows Gatekeeper verdict; `codesign -dvv <binary>` shows signing detail.
- If a command fails, **show the actual error output** in your response before proposing a fix.

### What "done" means

A task is done when:
- Tests pass (show the output)
- Typecheck passes (show the output)
- The actual behavior matches the spec scenario (show the command and its output)

Saying "this should work" or "the logic looks correct" without running anything is not done.

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.
