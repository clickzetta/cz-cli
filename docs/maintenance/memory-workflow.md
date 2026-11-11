# Memory protocol

The Worker uses and records experience; the Curator curates it; fresh agents test whether it helps. Use the [shared index](memory/INDEX.md), not client-private auto-memory. Every note rests on evidence; the Curator chooses the topics and their structure.

## Read and record

Start with the original request and latest decisions. Read relevant notes, their evidence, scope, and current facts. Give delegates these sources and acceptance criteria, not just your interpretation. Memory never expands authorization.

Record an event whenever a person corrects or reverses your answer or change, a reviewer rejects work for a cause that could recur, the same failure appears a second time, or a note misled you or was missing. State **previous belief, evidence, next-time action, affected note**. Record usage when a note demonstrably avoided repeat work. Routine successful reads need no event.

Create private JSON and run `bun scripts/maintenance.ts memory record FILE.json`:

```json
{
  "id": "task-example-auth-evidence-1",
  "taskId": "task-example",
  "kind": "correction",
  "summary": "Previous belief, counterevidence, and next-time check; mark unknown causes.",
  "evidence": ["Traceable original discussion or verification record"],
  "memoryRefs": ["docs/maintenance/understanding.md"]
}
```

Use a registered task ID; otherwise register an audit source through the existing task workflow. `kind` is `lesson`, `correction`, or `usage`. `memoryRefs` may be empty; evidence must be real, not planned verification.

Reuse the stable ID and identical content on retry. New evidence gets a new ID referencing the earlier event. Events are immutable; recording changes no task status, permission, or external state.

## Curate every twelve hours

1. Read the original material since the last successful cursor: session transcripts, issues, pull requests, comments, reviews, Feishu threads, runtime records, commits, and `memory pending`. The queue is a hint, not the boundary; an empty queue does not end the run. Start with the last day initially. Preserve failed-read gaps. For history predating this queue, inspect original tasks without inventing earlier write-backs.
2. Delegate reading and editing to **fresh contexts**, with scope, original sources, and current notes. Record candidate IDs, owner, and exclusive worktree; never dispatch a duplicate editor.
3. Verify evidence and human answers; merge repeats, correct contradictions, and check affected indexes and references. Weekly, revisit at least one older topic. Record the topic, check time, and next topic in private `control/curator-runtime.json`.
4. Retire disproven, obsolete, or unhelpful notes from active indexes; retain provenance and replacement links in the original note or Git history. Never discard a user constraint or critical exception merely because it is rarely used. Unresolved product choices remain decisions, not rules.
5. Record known errors immediately as corrections. Independently review formal edits before merging. Editors neither merge nor send externally; the Curator owns the merge and resolutions. Session transcripts and chat content are private: notes carry the lesson and a public source, never the private text.

Write notes as **trigger → conclusion and conditions → evidence/date/version → next action → invalidation or replacement**. State unknowns. Record how to check live state; label historical facts and pause-release conditions explicitly. Keep the actionable paragraph short, link detailed evidence, and maintain one authoritative conclusion with consistent indexes.

## Validate and merge

For changed conclusions, scope, indexes, or pruning, run affected [offline cases](memory-cases.md) with fresh agents starting at `docs/INDEX.md`. Withhold answers and the editor's summary. A separate reviewer scores actual outputs; fix failures without relaxing criteria. Formatting or broken-link fixes need only relevant checks.

Save document revision/diff, model, input, answer, reading path, and score. Compare versions only with matching models, inputs, permissions, and fresh sessions. Without a baseline, claim no percentage improvement. Offline runs make no external writes; real usage and correction events test continuing value.

Curate in an exclusive worktree from updated `origin/main` and open a docs-only PR. After independent review, merge it with `gh pr merge --admin --squash` and run `bun scripts/maintenance.ts sync`. Agents pick it up on their next read: the control checkout tracks main and every new task worktree starts from it. **Recorded, reviewed, and merged are separate states.** Keep events pending until the merge.

Then run `memory resolve ID FILE.json` with the merged main commit:

```json
{
  "disposition": "integrated",
  "reason": "Reviewed note is merged to main; note and index agree.",
  "evidence": ["https://github.com/OWNER/REPO/pull/NUMBER"],
  "commit": "ACTUAL_40_CHARACTER_MAIN_COMMIT_SHA",
  "memoryRefs": ["docs/maintenance/understanding.md"]
}
```

`integrated` requires a commit already on `origin/main`, note references, and real evidence. Coordinators may resolve `duplicate` with the existing event/note and rationale, or `no-change` with verified reasons and evidence. Investigation, decisions, validation, and merges still pending must not be resolved. Resolutions are immutable; later counterevidence becomes a new correction.

The journal carries learning evidence, not task ownership, authorization, or completion. Tools enforce format, idempotency, and the on-main check; independent review must still judge truth and usefulness.
