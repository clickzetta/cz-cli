# 测试、CI 和发布环境的坑

每条按「什么时候会踩 → 结论和条件 → 证据 → 下次怎么做」写。发现新坑或某条已失效，按[记忆协议](../maintenance/memory-workflow.md)记录。

- **在仓库根目录跑测试什么也测不到**：根目录的 `bunfig.toml` 把测试根指到了一个不存在的目录。进包目录（如 `packages/cz-cli`）再跑 `bun test`。证据：[bunfig.toml](../../bunfig.toml)、[AGENTS](../../AGENTS.md#testing)。
- **`bun typecheck` 只查 `src`**：`packages/cz-cli` 的 tsconfig 只包含 `src`，改了 `scripts/` 或 `test/` 它不会报错。维护脚本另跑 `bun typecheck --project tsconfig.tools.json`；普通测试文件没有类型检查，靠 `bun test` 发现问题。见 [验证](verification.md)。
- **pre-push 钩子检查整个工作区**：它跑全仓 `bun typecheck`，别人没提交的改动或旧的 `dist/` 会让干净的提交也推不上去。从独立的 detached worktree 推送，不要用 `git stash` 绕过。证据：[.husky/pre-push](../../.husky/pre-push)。
- **判断 PR 能不能合看 `cz-test`**：它在 GitHub 自带的 runner 上跑 cz-cli 的类型检查和单测。上游依赖 blacksmith runner 的工作流在这个 fork 里不会跑；`baseline-test` 只在改到发布、bootstrap 或 `bun.lock` 时触发。证据：[cz-test.yml](../../.github/workflows/cz-test.yml)。
- **`review` 检查变红不一定是超时**：它的超时是 20 分钟，但最近 34 次失败里只有 2 次跑满了超时，其余都是别的原因。先打开 run 日志看失败原因，不要默认忽略。证据：[claude-review.yml](../../.github/workflows/claude-review.yml)，2026-11-11 统计的最近 100 次运行。
- **换基线后的 `tmp` 目录名**：上游测试曾因改名后的临时目录失败，已修复并登记在补丁账本。证据：[#149](https://github.com/clickzetta/cz-cli/pull/149)、[#154](https://github.com/clickzetta/cz-cli/pull/154)。
