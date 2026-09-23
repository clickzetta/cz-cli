# SV development build validation — 2026-09-23

The `sv` CLI and 17 semantic-view Skills support model authoring, deployment/readback, query generation, VQR workflows, suggestions, audit and persistent optimization. Tableau/Power BI conversion is excluded; OSI remains.

Validation: 30 SV/system-prompt tests, 103 SDK readonly tests, 17 session processor tests passed; cz-cli typecheck passed. Historical native metadata used by tests is included under packages/cz-cli/test/fixtures/semantic-view so tests do not depend on private experiment directories. A macOS arm64 binary was built and smoke-tested.

Fresh online query smoke: isolated schema, czcli profile, DeepSeek v4 flash, actual cz-cli Agent. Agent loaded cz-semantic-view and the querying guide. Final SV SQL passed independent EXPLAIN and matched independently executed physical SQL and predeclared expected values (paid amount, nullable AVG, promotion ratio). Agent elapsed 90.6 seconds. Verification jobs: 202609231037209783zkbuumq2do7 (SV), 20260923103721582430kn2t7pp67 (physical). Test schema was removed.

Known limitation: the Agent still consulted old public docs and made six failed syntax attempts before recovering. Final correctness does not imply stable routing or measured uplift over a no-Skills group. This smoke used a fixture SV; it was not autonomous modeling or an A/B experiment. Raw transcripts remain local, outside the release commit.

Earlier live checks exercised generate, deploy, readback, recover, suggestions, query expansion with exact result comparison, and one metadata optimization iteration. The optimization score is a metadata-quality heuristic, not business-query accuracy. Deployment is multi-step; journals allow recovery and observed conflict checks, not distributed atomic replacement. Named filters are managed authoring metadata. Range/computed-key/many-to-many/non-left relationships remain blocked.

Distribution: development prerelease only. Use an isolated target schema for product trials. This is not a stable release or a claim of full Snowflake equivalence.
