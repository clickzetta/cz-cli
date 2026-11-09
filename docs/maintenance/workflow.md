# 维护工作流程

遵守根 [AGENTS.md](../../AGENTS.md)。使用 `gh` 读取 GitHub、`lark-cli` 读取目标群；命令与身份用各自 `--help`、内置资料核对。

## 本机记录

三个会话通过 `git rev-parse --git-common-dir` 定位同一公共 Git 目录，继续使用其中的 `cz-maintenance/`。在仓库根目录运行 `bun scripts/maintenance.ts init` 整理旧任务索引，再用 `status` 查看任务和实际授权。旧 `state.json`、`config.json`、游标、任务记录与 worktree 原样保留，新进度和来源映射保存到 `native-state.json`；旧执行器与间隔字段不参与原生调度。

授权唯一来源为该目录的 `config.json.permissions`，每轮重新读取。本次用户允许推送任务分支、创建 PR、GitHub 回报、Bot 回复、合入 PR，以及仅发布 nightly。通用 `release` 保持 `false`，单独使用 `releaseNightly: true`、`releaseStable: false`；工具拒绝开放通用或 stable 发布。Bot 回复限定于绑定的原群原话题。

本地模式的 `config.json.native.maintenanceRoot` 指向干净且已提交的控制 checkout，`native.policySha` 固定其 `HEAD`。循环与子 Agent 显式从这里启动、读取规则并调用维护工具，源码与测试在任务 worktree 中操作。每项任务记录同一个 `policySha`；任务进行时不切换该版本。

文档维护从 `policySha` 另开独占 worktree，经审查后保留提交。切换控制版本前结束仍使用旧版本的任务并保存交接，再更新本机 `native.policySha`；不把整套维护文档复制进产品修复 diff。

首次接手必须读取 `native-handoff.md` 并列出旧 `needs_attention`：PR 132、131、130、126、101、70、45、43、133 与两条飞书反馈。旧 ID、worktree 和来源映射继续使用；新来源先查询索引，不能因新旧 ID 格式不同重复建单。当前没有历史发送回执，`outbox/` 从零建立。

每项任务保存来源、验收条件、owner、worktree、`policySha`、`baseSha`、`headSha`、`reviewedSha`、验证、审查结论、外部动作、阻碍与下一步。GitHub 与飞书指向同一问题时关联到已有任务。

用 `task github:<owner>/<repo>:<编号>` 或 `task lark:<chat_id>:<message_id>` 查已有任务；`register ITEM.json` 按来源去重接单，`save TASK.json` 保存进度，均接在 `bun scripts/maintenance.ts` 后。任务正文与临时 JSON 留在本机。

## 自主推进与决策

默认自主推进已明确的需求和常规实现选择，不逐项请示。先核对原始上下文、实现、测试、引入提交和已有设计；能通过查证或验证解决的疑问继续调查，不把未完成的调查记为等待人工确认。现有行为和测试是兼容性证据，不能单独证明产品授权。

查证后仍有影响对外契约、数据可见性或授权范围的决策缺口时，只暂停依赖该决定的实施。回报已确认事实、推荐方案及影响，再提出一个具体问题；记录查证缺口，不用笼统的“请确认”代替调查。等待期间照常读取新进展，无新依据不重做同一调查或催问，后续轮次选择其他可推进任务。

## 唤醒与监听

飞书优先用原生 `Monitor` 接收事件，`/loop` 定时补扫兜底，间隔由 Claude 每轮决定。创建监听前先用 `ToolSearch` 核对当前 `Monitor`、`TaskStop` 的 schema、允许时限与停止方式，再用本机 `lark-cli event schema im.message.receive_v1` 和 `lark-cli event consume --help` 核对命令。满足[事件接入前提](INDEX.md#飞书事件前提)后，消费命令为 `lark-cli event consume im.message.receive_v1 --as bot --timeout DURATION --jq 'select(.chat_id=="CHAT_ID")'`；替换为配置中的目标群，先过滤再向模型输出。`DURATION` 必须短于 Monitor 允许时限，有界运行可避免 stdin EOF 导致提前退出。

同群只保留一个监听实例，owner、Monitor task ID 与到期时间保存在本机 runtime 的 `control/`。按 `event_id`、`message_id` 去重，过滤目标群并补读话题上下文；忙时将待处理来源排队，每轮仍只推进一个实施任务。断线、退出或到期后先核对旧任务状态，再续建监听，并按保存的游标重叠补扫。事件通知只触发来源核对，不构成用户授权。

飞书订阅、权限、连接 ready 和真实目标群事件尚未全部验收时，不得宣称事件接入上线。本地 Monitor 测试只证明本地机制可用；ready、断线、超时等运行诊断留在本机日志，不发群。

## 推进一项任务

1. 核对当前配置、`native-handoff.md`、工具列出的旧任务与来源最新上下文。用稳定来源键查询旧 ID，再认领或注册任务；来源有更新时补充已有任务，不另建重复任务。
2. 在 `claims/` 下原子创建该任务的目录，成功后记录 owner；已存在或归属不明时不接管。各会话只修改自己持有的任务与控制记录，不抢占未对账的认领。
3. 新修复从更新后的 `origin/main` 精确 SHA 创建独占 worktree，记录 `baseSha`；显式给实施者控制 checkout 的规则入口与 `policySha`，不从源码 worktree 的旧指令猜测维护基线。PR 审查保留 PR head 和实际 merge-base；历史跨度异常时先交接，不直接移植整段差异。接手历史任务先核对现场与副作用。
4. 实施完成后从控制 checkout 的 loop 会话中派新的审查子 Agent，只提供最终 diff、SHA、验收条件、验证日志、控制规则版本和源码入口，不提供实施者总结，也不继承其实施对话。审查者可读取源码和相关契约，结论与实际 `reviewedSha` 写入任务记录；审查后任何源码变化都重做审查。审查失败可返修，保留真实失败。
5. 独立审查通过后，保存 `phase: review`、`status: completed`、实际 `reviewedSha`，再按权限推送任务分支、创建 PR。合入统一使用 `bun scripts/maintenance.ts merge TASK PR` 预览，加 `--merge` 执行；工具核对最终远端 SHA、独立审查与 CI，保存实际 merge commit。管理员仅在 PR 审批规则上豁免，普通贡献者仍需一个批准，main 删除和 force push 保护保留。
6. 产品修复合入后按[发布约定](../engineering/releases.md)发布 nightly，核对实际产物后回报；纯文档、测试或维护工具改动无需发版。每轮最多推进一个实施任务，审查、返修与交付属于同一任务。完成本轮或遇到决策、授权阻碍时保存交接并结束，不连续开新任务。没有执行者继续写入后才释放本人认领。

`cz-test/test` 必须成功，其他失败或 pending 检查默认阻断。旧 `Claude Code Review` 有既存网关故障，本机可显式以 `mergePolicy.informationalWorkflows` 将这一工作流设为参考；它不能代替本地独立审查，不能豁免产品测试。移除该配置即恢复所有检查阻断。

## 来源与回报

GitHub 首轮核对现有 open Issue 与 PR，后续读取更新。飞书首轮按配置范围回溯，后续增量读取并保留重叠窗口，补齐话题根消息。分页或上下文未完成时记录缺口，不越过未处理范围推进成功游标。

飞书读取使用已授权用户，回复使用已入群 Bot。所有 Bot 回复通过维护工具调用 `lark-cli im +messages-reply --reply-in-thread --idempotency-key`，不直接绕过 outbox 发送。确需回报时，阶段从 `接单`、`阻碍`、`审查完成`、`发布完成` 中选择，采用新消息回报状态变化：

```sh
bun scripts/maintenance.ts reply TASK 阻碍 --event STABLE_EVENT --text-file draft.txt
bun scripts/maintenance.ts reply TASK 阻碍 --event STABLE_EVENT --text-file draft.txt --send
```

首条命令只预览。`STABLE_EVENT` 标识确定的状态变化，如 `blocker-missing-scope` 或 `review-<SHA>`；同事件重试保持相同标识和正文，不随机生成或按执行次数变化。工具在原子锁内为新事件分配序号，生成 `<任务ID>-<阶段>-<序号>`；重复事件沿用已有 key，不因重试递增。发送前保存固定目标、正文、key 与 `sending`，成功保存 `sent` 和 `message_id`。查回执使用 `status`。

超时或响应不明记为 `unknown`，同一目标暂停后续发送；核对原话题的时间、Bot 身份和正文，确认后再人工登记回执。没有按 key 查询服务端的接口；服务端去重仅一小时，不能靠换序号或跨小时重试绕过未知结果。GitHub 回复及其他外部操作分别核对授权。

## 对外回复

默认 1–3 句，通常 150 汉字以内，能一句说清就一句；只作软目标，不硬截断。先给结论，再交代实际动作与状态；确需对方补充信息或决定时，只问一个具体问题。省去固定前缀、套话和重复上下文，无变化不发，不要求每个阶段都发。

调查过程、测试清单、内部任务 ID 和幂等 key 留在本机日志，正文按需附 Issue 或 PR 链接。技术 review 或对方主动索要详情时，可展开必要定位与证据；简短不能省略重要风险、未验证状态或必要决策。

验收命令见[验证约定](../engineering/verification.md)。行为与契约变化同步更新所属领域文档，任务日志留在本机。
