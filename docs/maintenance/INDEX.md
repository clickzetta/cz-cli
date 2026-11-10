# 自动维护

使用 Claude Code 原生 `/loop` 和 `Monitor`，模型为 `claude-sonnet-5-5`，项目知识通过 [docs 索引](../INDEX.md)按需读取。只在维护会话的启动参数中关闭 auto-memory，日常交互会话沿用原设置。

- [工作流程](workflow.md)：认领、独占工作区、验收、交接与回报。
- [反馈 prompt](prompts/feedback.md)：统一处理 GitHub 与飞书。
- [反思 prompt](prompts/reflection.md)：每十二小时整理易误解点、人工待决和重复故障。
- [设计依据](design.md)：参考做法及采用范围。
- [易误解点](understanding.md)、[人工待决](decisions.md)、[重复故障](recurring-failures.md)。

## 启用门槛

本地试跑使用已提交且干净的控制 checkout，无需先合入 `main`。将其绝对路径写入本机 `config.json.native.maintenanceRoot`；两个循环以及实施、审查子 Agent 统一读取这里的 `AGENTS.md`、docs 和维护工具。每个执行阶段记录控制 checkout 的 `policySha`，阶段内保持该版本不变。

启动时显式进入该目录，核对工作区干净且 `HEAD` 等于本机配置的 `native.policySha`；路径配置不会自动切换 Claude 的工作目录。子 Agent 从控制会话派出，将源码 worktree 作为明确路径传入。

新修复的代码 worktree 仍从更新后的 `origin/main` 精确 SHA 创建；源码基线与维护规则版本分别记录。任务 worktree 即使尚不含新 docs，也不能退回其中旧版维护规则。后续团队部署时可将维护改动合入 `main`，本地试跑不依赖 PR。

启用前由用户提供本机 URL、key 与认证方式，核对来源范围和外部授权，并验证一次模型连接与有边界的首轮任务。凭据不写进提示词或仓库。先在控制 checkout 根目录运行：

```sh
bun scripts/maintenance.ts init
bun scripts/maintenance.ts status
```

核对旧任务、11 个待处理来源、权限和回执目录，再按下文启动、验收两个会话。清理旧 worktree 需要用户逐项确认，不阻塞启用。交接中更新实际监听状态和待修复故障，按当前配置与授权完成接入。

## 飞书事件前提

Bot 必须已入目标群，应用具备群全消息权限 `im:message.group_msg`；用户身份可读消息或具备 `send_as_bot` 不等于已订阅 Bot 事件。在飞书开发者控制台选择长连接接收事件，订阅 `im.message.receive_v1`，并确认配置已发布生效。

先用本机 `lark-cli event schema im.message.receive_v1` 和 `lark-cli event consume --help` 核对要求；1.0.58 的 schema 还预检 `im:message.p2p_msg:readonly`，不能仅凭群权限推断命令可用。飞书会话必须按[唤醒与监听](workflow.md#唤醒与监听)启动实际消费者，验证上游连接和真实目标群事件。缺失条件须查明并修复，不能只留下“以后验收”便宣称部署完成。

## 两个会话

仅在首次创建时运行下面命令。已有会话使用原 ID 恢复，先以 CronList 去重，不重复执行 /loop。切换旧三角色时先在安全边界保存任务、claim、后台执行者和外部回执，删除旧周期任务；保留一个反馈会话和一个反思会话，旧渠道会话停止后不再恢复。监听只能有一个 owner。

维护会话已获授权使用 bypassPermissions。私有 settings 只为维护会话关闭 auto-memory，保留现有连接配置，不能提交。进入控制 checkout，设置：

```sh
CZ_MAINTENANCE_RUNTIME="$(git rev-parse --path-format=absolute --git-common-dir)/cz-maintenance"
CZ_MAINTENANCE_SETTINGS="$CZ_MAINTENANCE_RUNTIME/native-claude-settings.json"
CZ_MAINTENANCE_WORKTREES="$(bun -e 'console.log((await Bun.file(Bun.argv[1]).json()).native.worktreeRoot)' "$CZ_MAINTENANCE_RUNTIME/config.json")"
```

反馈 Agent：

```sh
claude --background --name cz-feedback --model claude-sonnet-5-5 \
  --permission-mode bypassPermissions --allowedTools 'Bash,Agent,Skill,CronCreate,CronList,CronDelete,ToolSearch,Monitor,TaskStop' \
  --add-dir "$CZ_MAINTENANCE_RUNTIME" --add-dir "$CZ_MAINTENANCE_WORKTREES" \
  --settings "$CZ_MAINTENANCE_SETTINGS" \
  '/loop 5m 读取 docs/maintenance/prompts/feedback.md，实际保持唯一飞书 Monitor，统一处理两个来源。'
```

反思 Agent：

```sh
claude --background --name cz-reflection --model claude-sonnet-5-5 \
  --permission-mode bypassPermissions --allowedTools 'Bash,Agent,Skill,CronCreate,CronList,CronDelete,ToolSearch' \
  --add-dir "$CZ_MAINTENANCE_RUNTIME" --add-dir "$CZ_MAINTENANCE_WORKTREES" \
  --settings "$CZ_MAINTENANCE_SETTINGS" \
  '/loop 12h 读取 docs/maintenance/prompts/reflection.md，整理有依据的易误解点、人工待决和重复故障。'
```

不同任务可由后台子 Agent 并行实施，各用独占 worktree；同一任务不重复派工，完成后另外派独立审查者。主会话持续接收、读取和回应反馈。/loop 后面是让 Claude 读取文件的指令。

通过 claude agents、claude logs ID 和 claude stop ID 查看和停止原生会话。服务器现有包装器使用 maintenance attach feedback / reflection；使用原 ID，不创建副本。恢复后核对周期、到期及原生 Monitor 的实际状态，进程恢复本身不证明监听和调度已恢复。GitHub 当前用增量轮询，不声称已接 Webhook。

## 验收与恢复

用真实 Issue、PR 评论和飞书自然到达的消息核对来源、任务关联、处置及 message_id。用户要求不发送飞书测试消息；未获得自然事件到回复证据前，只报告实际已核验的连接和读取。

核对两个原生周期任务：反馈五分钟，反思十二小时；检查无遗留渠道定时器、重复消费者或活动实施者。重放来源用本地测试核对去重，不向群注入消息。真实 CI 和独立审查继续阻断不合格交付，发布只准 nightly。

会话级设置见[官方说明](https://code.claude.com/docs/en/settings#change-a-setting-for-one-session)，循环的到期与恢复见[原生调度说明](https://code.claude.com/docs/en/scheduled-tasks)。
