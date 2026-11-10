# 自动维护

使用 Claude Code 原生 `/loop` 和 `Monitor`，模型为 `claude-sonnet-5-5`，项目知识通过 [docs 索引](../INDEX.md)按需读取。只在维护会话的启动参数中关闭 auto-memory，日常交互会话沿用原设置。

- [工作流程](workflow.md)：认领、独占工作区、验收、交接与回报。
- [GitHub prompt](prompts/github.md)：Issue、PR 与审查反馈。
- [飞书 prompt](prompts/feishu.md)：目标群的反馈与 Bot 回报。
- [维护 prompt](prompts/review.md)：代码健康与文档一致性。

## 启用门槛

本地试跑使用已提交且干净的控制 checkout，无需先合入 `main`。将其绝对路径写入本机 `config.json.native.maintenanceRoot`；三个循环以及实施、审查子 Agent 统一读取这里的 `AGENTS.md`、docs 和维护工具。每个执行阶段记录控制 checkout 的 `policySha`，阶段内保持该版本不变。

启动时显式进入该目录，核对工作区干净且 `HEAD` 等于本机配置的 `native.policySha`；路径配置不会自动切换 Claude 的工作目录。子 Agent 从控制会话派出，将源码 worktree 作为明确路径传入。

新修复的代码 worktree 仍从更新后的 `origin/main` 精确 SHA 创建；源码基线与维护规则版本分别记录。任务 worktree 即使尚不含新 docs，也不能退回其中旧版维护规则。后续团队部署时可将维护改动合入 `main`，本地试跑不依赖 PR。

启用前由用户提供本机 URL、key 与认证方式，核对来源范围和外部授权，并验证一次模型连接与有边界的首轮任务。凭据不写进提示词或仓库。先在控制 checkout 根目录运行：

```sh
bun scripts/maintenance.ts init
bun scripts/maintenance.ts status
```

核对旧任务、11 个待处理来源、权限和回执目录，再按下文启动、验收三个会话。清理旧 worktree 需要用户逐项确认，不阻塞启用。交接中更新实际监听状态和待修复故障，按当前配置与授权完成接入。

## 飞书事件前提

Bot 必须已入目标群，应用具备群全消息权限 `im:message.group_msg`；用户身份可读消息或具备 `send_as_bot` 不等于已订阅 Bot 事件。在飞书开发者控制台选择长连接接收事件，订阅 `im.message.receive_v1`，并确认配置已发布生效。

先用本机 `lark-cli event schema im.message.receive_v1` 和 `lark-cli event consume --help` 核对要求；1.0.58 的 schema 还预检 `im:message.p2p_msg:readonly`，不能仅凭群权限推断命令可用。飞书会话必须按[唤醒与监听](workflow.md#唤醒与监听)启动实际消费者，验证上游连接和真实目标群事件。缺失条件须查明并修复，不能只留下“以后验收”便宣称部署完成。

## 三个会话

下列命令用于在控制 checkout 根目录首次创建三个会话；已存在时使用原 ID 或服务器已有包装器恢复，不再创建副本。每次启动或恢复都携带相同的 `--settings`，不修改仓库或用户级记忆开关。GitHub 和飞书固定每五分钟补扫，代码与文档维护每三十分钟检查。安静或任务阻碍不延长来源补扫间隔；忙时排队，回到可处理边界先读取来源。

当前维护会话已获用户授权使用 `bypassPermissions`，合入和发布仍经守卫工具。私有 settings 文件仅在本机保存连接信息并关闭 auto-memory，不提交仓库。先设置三个终端共用的路径：

```sh
CZ_MAINTENANCE_RUNTIME="$(git rev-parse --path-format=absolute --git-common-dir)/cz-maintenance"
CZ_MAINTENANCE_SETTINGS="$CZ_MAINTENANCE_RUNTIME/native-claude-settings.json"
CZ_MAINTENANCE_WORKTREES="$(bun -e 'console.log((await Bun.file(Bun.argv[1]).json()).native.worktreeRoot)' "$CZ_MAINTENANCE_RUNTIME/config.json")"
```

GitHub：

```sh
claude --background --name cz-github --model claude-sonnet-5-5 \
  --permission-mode bypassPermissions --allowedTools 'Bash,Agent,Skill,CronCreate,CronList,CronDelete' \
  --add-dir "$CZ_MAINTENANCE_RUNTIME" --add-dir "$CZ_MAINTENANCE_WORKTREES" \
  --settings "$CZ_MAINTENANCE_SETTINGS" \
  '/loop 5m 持续维护 GitHub，读取 docs/maintenance/prompts/github.md，先执行 intake，再按要求推进。'
```

飞书：下列参数开放监听工具，实际消费者仍由原会话中的 Monitor 启动。

```sh
claude --background --name cz-feishu --model claude-sonnet-5-5 \
  --permission-mode bypassPermissions --allowedTools 'Bash,Agent,Skill,CronCreate,CronList,CronDelete,ToolSearch,Monitor,TaskStop' \
  --add-dir "$CZ_MAINTENANCE_RUNTIME" --add-dir "$CZ_MAINTENANCE_WORKTREES" \
  --settings "$CZ_MAINTENANCE_SETTINGS" \
  '/loop 5m 持续处理飞书反馈，读取 docs/maintenance/prompts/feishu.md，启动或复用实际连接的 Monitor，先执行 intake 再推进。'
```

维护：

```sh
claude --background --name cz-review --model claude-sonnet-5-5 \
  --permission-mode bypassPermissions --allowedTools 'Bash,Agent,Skill,CronCreate,CronList,CronDelete' \
  --add-dir "$CZ_MAINTENANCE_RUNTIME" --add-dir "$CZ_MAINTENANCE_WORKTREES" \
  --settings "$CZ_MAINTENANCE_SETTINGS" \
  '/loop 30m 持续检查代码与文档，读取 docs/maintenance/prompts/review.md，核对待处理来源和已有任务后推进。'
```

三个角色共享任务认领，每轮最多推进一个实施任务；读取、记录与回复新反馈照常进行。每项改动另做独立审查。`/loop` 后面是让 Claude 读取文件的指令，不是执行文件的 shell 命令。

通过 `claude agents` 查看运行与等待状态，`claude logs ID` 查看输出，`claude stop ID` 停止指定会话。后台原生会话由 Claude Code 自身管理。已有服务器包装器继续使用 `maintenance status`、`maintenance attach ROLE`、`maintenance respawn ROLE`，`ROLE` 为 `github`、`feishu`、`review`。恢复时使用原 ID，不创建副本；重启后在原会话用 `CronList` 去重、补建固定调度，并实际恢复飞书 Monitor。

## 部署验收

在目标群验证一条新话题和一条旧话题回复：Monitor 收到事件、原会话唤醒、`intake feishu` 返回完整上下文、任务或回复落盘、原话题收到 Bot 回复，记录事件 ID、读取记录与 `message_id`。GitHub 用新 Issue 和仅新增评论、head 不变的 PR 验证同样链路。

停止事件消费者后确认五分钟补扫仍能收取来源；再验证断线续建、到期续建和会话重启恢复。重放同一事件不重复建单或回复。测试结果和实际监听 owner、task ID、到期时间留在本机；所有环节通过后才报告完整部署成功。

会话级设置见[官方说明](https://code.claude.com/docs/en/settings#change-a-setting-for-one-session)，循环的运行条件、到期与恢复见[原生调度说明](https://code.claude.com/docs/en/scheduled-tasks)。
