# Human decisions

Keep unresolved decisions in private runtime `control/daily-decisions.md`. Each entry records date, stable task ID, verified facts, one concrete decision, recommendation, impact and original discussion. The Worker asks once in that discussion. When a maintainer answers, only the Worker records the decision, with a link to the reply and `verified-by: worker`, and updates the task. The Curator checks for answers and may mark a question answered or stale.

Publish only confirmed, public long-term decisions in their topic docs, with sources. Keep private discussions, user details and runtime data local; unresolved proposals are not product rules.

Resolve facts through source, tests and existing discussions. Failed CI or unfinished implementation does not imply missing approval. Pause only work dependent on a real decision; resume when it is settled.

## Channel reply languages and proactive triage

Feishu group Bot replies (`cz-maintenance reply`) use Simplified Chinese, while GitHub issue/PR comments, repository code, maintenance docs, commit messages, and PR text use English (superseding the blanket reply-language clause in [PR #213](https://github.com/clickzetta/cz-cli/pull/213)). Before asking clarifying questions on a bug report or broad request, Worker replies summarize relevant behavior already verified on `origin/main` and published releases, ask only for the specific unresolved scope or decision, and do not request `cz-cli --version` unless a verified behavioral difference across versions changes the diagnosis or next action.

Source: [PR #233 maintainer decision](https://github.com/clickzetta/cz-cli/pull/233#issuecomment-7212473399).
