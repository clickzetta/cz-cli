# 自动维护

使用 Claude Code 原生 `/loop`，首版选用 `claude-opus-5-5`，项目知识通过 [docs 索引](../INDEX.md)按需读取。只在维护会话的启动参数中关闭 auto-memory，日常交互会话沿用原设置。

- [工作流程](workflow.md)：认领、独占工作区、验收、交接与回报。
- [GitHub prompt](prompts/github.md)：Issue、PR 与审查反馈。
- [飞书 prompt](prompts/feishu.md)：目标群的反馈与 Bot 回报。
- [维护 prompt](prompts/review.md)：代码健康与文档一致性。

## 启用门槛

维护代码与 docs 必须先合入 `main`。更新 `origin/main` 后，确认其包含本版 `AGENTS.md`、docs 和维护工具；新任务从该精确 SHA 创建 worktree，实施者与审查者读取各自 worktree 内相同版本的规则。

启用前由用户提供本机 URL、key 与认证方式，核对来源范围和外部授权。凭据不写进提示词或仓库。先在仓库根目录运行：

```sh
bun scripts/maintenance.ts init
bun scripts/maintenance.ts status
```

核对旧任务、11 个待处理来源、权限和回执目录，完成[工作流程](workflow.md)要求的检查后，再启动三个会话。清理旧 worktree 需要用户逐项确认，不阻塞启用。

## 三个会话

在仓库根目录的三个终端中分别运行下列命令。每次启动或恢复维护会话都携带相同的 `--settings`，不修改仓库或用户级记忆开关。以下 `5m` 为示例间隔。

GitHub：

```sh
claude --name cz-github --model claude-opus-5-5 --settings '{"autoMemoryEnabled":false}'
```

```text
/loop 5m 读取 docs/maintenance/prompts/github.md，按其中要求执行一轮。
```

飞书：

```sh
claude --name cz-feishu --model claude-opus-5-5 --settings '{"autoMemoryEnabled":false}'
```

```text
/loop 5m 读取 docs/maintenance/prompts/feishu.md，按其中要求执行一轮。
```

维护：

```sh
claude --name cz-review --model claude-opus-5-5 --settings '{"autoMemoryEnabled":false}'
```

```text
/loop 5m 读取 docs/maintenance/prompts/review.md，按其中要求执行一轮。
```

三个角色共享任务认领，每轮最多推进一个实施任务；每项改动另做独立审查。`/loop` 后面是让 Claude 读取文件的指令，不是执行文件的 shell 命令。

会话级设置见[官方说明](https://code.claude.com/docs/en/settings#change-a-setting-for-one-session)，循环的运行条件、到期与恢复见[原生调度说明](https://code.claude.com/docs/en/scheduled-tasks)。
