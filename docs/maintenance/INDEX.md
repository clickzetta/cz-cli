# 自动维护

使用 Claude Code 原生 `/loop`，首版选用 `claude-opus-5-5`，项目知识通过 [docs 索引](../INDEX.md)按需读取。只在维护会话的启动参数中关闭 auto-memory，日常交互会话沿用原设置。

- [工作流程](workflow.md)：认领、独占工作区、验收、交接与回报。
- [GitHub prompt](prompts/github.md)：Issue、PR 与审查反馈。
- [飞书 prompt](prompts/feishu.md)：目标群的反馈与 Bot 回报。
- [维护 prompt](prompts/review.md)：代码健康与文档一致性。

## 启用门槛

本地试跑使用已提交且干净的控制 checkout，无需先合入 `main`。将其绝对路径写入本机 `config.json.native.maintenanceRoot`；三个循环以及实施、审查子 Agent 统一读取这里的 `AGENTS.md`、docs 和维护工具。每项任务记录控制 checkout 的 `policySha`，期间保持该版本不变。

启动时显式进入该目录，核对工作区干净且 `HEAD` 等于本机配置的 `native.policySha`；路径配置不会自动切换 Claude 的工作目录。子 Agent 从控制会话派出，将源码 worktree 作为明确路径传入。

新修复的代码 worktree 仍从更新后的 `origin/main` 精确 SHA 创建；源码基线与维护规则版本分别记录。任务 worktree 即使尚不含新 docs，也不能退回其中旧版维护规则。后续团队部署时可将维护改动合入 `main`，本地试跑不依赖 PR。

启用前由用户提供本机 URL、key 与认证方式，核对来源范围和外部授权，并验证一次模型连接与有边界的首轮任务。凭据不写进提示词或仓库。先在控制 checkout 根目录运行：

```sh
bun scripts/maintenance.ts init
bun scripts/maintenance.ts status
```

核对旧任务、11 个待处理来源、权限和回执目录，完成[工作流程](workflow.md)要求的检查后，再启动三个会话。清理旧 worktree 需要用户逐项确认，不阻塞启用。

## 三个会话

在控制 checkout 根目录的三个终端中分别运行下列命令。每次启动或恢复维护会话都携带相同的 `--settings`，不修改仓库或用户级记忆开关。`/loop` 不指定间隔，由 Claude 每轮决定下次检查时间；这是持续维护，暂时无反馈时等待下一轮，不视为整个维护任务完成。

GitHub：

```sh
claude --name cz-github --model claude-opus-5-5 --settings '{"autoMemoryEnabled":false}'
```

```text
/loop 持续维护 GitHub，读取 docs/maintenance/prompts/github.md 按要求推进，空闲时等待下一轮。
```

飞书：

```sh
claude --name cz-feishu --model claude-opus-5-5 --settings '{"autoMemoryEnabled":false}'
```

```text
/loop 持续处理飞书反馈，读取 docs/maintenance/prompts/feishu.md 按要求推进，空闲时等待下一轮。
```

维护：

```sh
claude --name cz-review --model claude-opus-5-5 --settings '{"autoMemoryEnabled":false}'
```

```text
/loop 持续检查代码与文档，读取 docs/maintenance/prompts/review.md 按要求推进，空闲时等待下一轮。
```

三个角色共享任务认领，每轮最多推进一个实施任务；每项改动另做独立审查。`/loop` 后面是让 Claude 读取文件的指令，不是执行文件的 shell 命令。

会话级设置见[官方说明](https://code.claude.com/docs/en/settings#change-a-setting-for-one-session)，循环的运行条件、到期与恢复见[原生调度说明](https://code.claude.com/docs/en/scheduled-tasks)。
