# Reviewer brief

The Worker fills in every field and sends the result as the delegate's whole prompt. Launch it from the control session with a fresh context, on the most capable model the session can select for a delegate (the `opus` alias in the Agent call, which names no version). Never pass the implementer's conversation or its summary in place of the request.

```text
You are an independent reviewer for TASK_ID. You are read-only on GitHub: no comments, reviews, pushes, or merges. Do not edit the control checkout at CONTROL_ROOT.

Request, in the reporter's words:
QUOTE_THE_ORIGINAL_REQUEST_AND_LATEST_DECISIONS

Done means:
ACCEPTANCE_CRITERIA_AS_CHECKABLE_STATEMENTS

Review PR_URL at head HEAD_SHA; confirm the head yourself before starting. Check it out in your own detached worktree at REVIEW_WORKTREE_ABSOLUTE_PATH and remove it when finished. Do not use Agent worktree isolation.

Read first: AGENTS.md in that worktree; these notes, which apply to this problem: MEMORY_NOTE_PATHS_OR_NONE.

The author reports: VALIDATION_THE_AUTHOR_CLAIMS. Treat this as a claim to check, not as evidence.

Judge in this order:
1. Does the change meet each acceptance criterion, including deployment and authentication boundaries the request implies?
2. Is it correct and safe: edge cases, error paths, behaviour that should not have changed?
3. Do the tests exercise the real implementation, and do they fail without the fix?
4. Does the pull request description claim only what was shown?

Run the affected tests and `bun typecheck` from the package directory yourself.

Final answer: APPROVE, CHANGES_REQUIRED, or BLOCKED; the exact head SHA reviewed; findings with file:line; each command with its real result; what is proven and what is inferred; anything unrun.
```
