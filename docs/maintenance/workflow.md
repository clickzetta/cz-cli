# 维护工作流程

遵守根 [AGENTS.md](../../AGENTS.md)。使用 `gh` 读取 GitHub、`lark-cli` 读取目标群；命令与身份用各自 `--help`、内置资料核对。

## 本机记录

两个常驻会话通过 `git rev-parse --git-common-dir` 定位同一公共 Git 目录，继续使用其中的 `cz-maintenance/`。在仓库根目录运行 `bun scripts/maintenance.ts init` 整理旧任务索引，再用 `status` 查看任务和实际授权。旧 `state.json`、`config.json`、游标、任务记录与 worktree 原样保留，新进度和来源映射保存到 `native-state.json`；旧执行器与间隔字段不参与原生调度。

授权唯一来源为该目录的 `config.json.permissions`，每轮重新读取。本次用户允许推送任务分支、创建 PR、GitHub 回报、Bot 回复、合入 PR，以及仅发布 nightly。通用 `release` 保持 `false`，单独使用 `releaseNightly: true`、`releaseStable: false`；工具拒绝开放通用或 stable 发布。Bot 回复限定于绑定的原群原话题。

本地模式的 `config.json.native.maintenanceRoot` 指向干净且已提交的控制 checkout，`native.policySha` 固定其 `HEAD`。循环与子 Agent 显式从这里启动、读取规则并调用维护工具，源码与测试在任务 worktree 中操作。每个执行阶段记录 `policySha`，阶段内不切换该版本。

文档和维护工具从 `policySha` 另开独占 worktree，经验证、审查后保留提交。切换前让旧执行者停止写入，保存任务、认领与外部动作交接，再更新控制 checkout 和本机 `native.policySha`，验证后恢复任务。保留历史 `policySha`、验证及审查证据，后续执行阶段另记新版本，不倒填旧记录。已授权范围内的升级由维护会话协调完成，不自行追加一次人工批准，也不把整套维护文档复制进产品修复 diff。

首次接手必须读取 `native-handoff.md` 并列出旧 `needs_attention`：PR 132、131、130、126、101、70、45、43、133 与两条飞书反馈。旧 ID、worktree 和来源映射继续使用；新来源先查询索引，不能因新旧 ID 格式不同重复建单。当前没有历史发送回执，`outbox/` 从零建立。

每项任务保存来源、验收条件、owner、worktree、`policySha`、`baseSha`、`headSha`、`reviewedSha`、验证、审查结论、外部动作、阻碍与下一步。GitHub 与飞书指向同一问题时关联到已有任务。

用 `task github:<owner>/<repo>:<编号>` 或 `task lark:<chat_id>:<message_id>` 查已有任务；`register ITEM.json` 按来源去重接单，`save TASK.json` 保存进度，均接在 `bun scripts/maintenance.ts` 后。任务正文与临时 JSON 留在本机。

## 自主推进与决策

默认自主推进已明确的需求和常规实现选择，不逐项请示。先核对原始上下文、实现、测试、引入提交和已有设计；能通过查证或验证解决的疑问继续调查，不把未完成的调查记为等待人工确认。现有行为和测试是兼容性证据，不能单独证明产品授权。

查证后仍有影响对外契约、数据可见性或授权范围的决策缺口时，只暂停依赖该决定的实施。回报已确认事实、推荐方案及影响，再提出一个具体问题；记录查证缺口，不用笼统的“请确认”代替调查。等待期间照常读取新进展，无新依据不重做同一调查或催问，后续轮次选择其他可推进任务。

“修复或复审前暂停合入”随条件满足而解除，不改写成“必须用户再次批准”。按当前授权和真实验收证据推进；失败的 CI、尚未满足的验收条件仍会阻断对应交付。

## 唤醒与监听

反馈会话在启动、恢复和每次唤醒时核对原生 Monitor task 与 `lark-cli event status --current --json`。按当前[事件接入条件](INDEX.md#飞书事件前提)启动或复用实际连接的消费者；开放 `Monitor` 工具本身不会启动监听。

核对当前 `Monitor`、`TaskStop` 工具定义，必要时用 `ToolSearch` 发现工具。Monitor 直接执行本机 `config.json.native.larkBinary` 指定的官方原生二进制，不经不能转发停止信号的 npm 包装器。消费命令为 `LARK_BINARY event consume im.message.receive_v1 --as bot --timeout 1500s --jq 'select(.chat_id=="CHAT_ID")'`，替换实际二进制路径和目标群；Monitor 时限为 1800000 ms，先以当前 schema 确认可用。只有上游源报告 connected 且目标群真实事件到达，才算事件接入可用，本地 `ready` 行不足以证明连接成功。

同群只保留一个监听，Agent 将 owner、Monitor task ID 和到期时间写在本机 runtime 的 `control/`。每次检查 task 是否存活、CLI 状态及源连接日志；到期前或失联后用 `TaskStop` 停止旧 task，确认旧消费者退出再续建。随后执行 `intake feishu` 补扫缺口。事件唤醒先按消息 ID 定向读取原话题并核对稳定来源；完整 intake 补扫在后台进行，不重复启动同来源扫描。定向读取失败或未完成的扫描不能算已检查；事件通知只触发核对，不构成新增授权。

反馈会话保留一个原生五分钟补扫，覆盖 GitHub 和飞书；反思会话每十二小时检查一次。使用 `CronList` 核对，清理同角色旧的动态补扫，不能同时维护两套来源定时器。安静、已有任务阻碍或监听健康都不延长来源补扫间隔；长实施派给有边界的子 Agent，反馈主会话在安全边界先读取新反馈；忙时可能延迟，不能承诺事件到达即完成处理。记录监听和补扫各自的实际健康，监听故障时继续完整补扫并修复，不将降级状态报告为完整上线。运行诊断留在本机，不发群。

## 推进一项任务

1. 核对当前配置、`native-handoff.md`、工具列出的旧任务与来源最新上下文。用稳定来源键查询旧 ID，再认领或注册任务；来源有更新时补充已有任务，不另建重复任务。
2. 在 `claims/` 下原子创建该任务的目录，成功后记录 owner；已存在或归属不明时不接管。各会话只修改自己持有的任务与控制记录，不抢占未对账的认领。
3. 新修复从更新后的 `origin/main` 精确 SHA 创建独占 worktree，记录 `baseSha`；显式给实施者控制 checkout 的规则入口与 `policySha`，不从源码 worktree 的旧指令猜测维护基线。PR 审查保留 PR head 和实际 merge-base；历史跨度异常时先交接，不直接移植整段差异。接手历史任务先核对现场与副作用。
4. 实施完成后从控制 checkout 的 loop 会话中派新的审查子 Agent，只提供最终 diff、SHA、验收条件、验证日志、控制规则版本和源码入口，不提供实施者总结，也不继承其实施对话。审查者可读取源码和相关契约，结论与实际 `reviewedSha` 写入任务记录；审查后任何源码变化都重做审查。审查失败可返修，保留真实失败。
5. 独立审查通过后，保存 `phase: review`、`status: completed`、实际 `reviewedSha`，再按权限推送任务分支、创建 PR。合入统一使用 `bun scripts/maintenance.ts merge TASK PR` 预览，加 `--merge` 执行；工具核对最终远端 SHA、独立审查与 CI，保存实际 merge commit。管理员仅在 PR 审批规则上豁免，普通贡献者仍需一个批准，main 删除和 force push 保护保留。
6. 产品修复合入后按[发布约定](../engineering/releases.md)发布 nightly，核对实际产物后回报；纯文档、测试或维护工具改动无需发版。同时只推进一个实施任务，审查、返修与交付属于同一任务；受阻任务保存交接且无执行者继续写入后可暂挂，转办其他任务。没有执行者继续写入后才释放本人认领。

`cz-test/test` 必须成功，其他失败或 pending 检查默认阻断。旧 `Claude Code Review` 有既存网关故障，本机可显式以 `mergePolicy.informationalWorkflows` 将这一工作流设为参考；它不能代替本地独立审查，不能豁免产品测试。移除该配置即恢复所有检查阻断。

## 来源与回报

定时补扫读取 `bun scripts/maintenance.ts intake github` 和 `intake feishu`，处理两个来源返回的持久化 `pending`；不能用 PR head 不变、群根消息为空或旧游标文件代替完整读取。GitHub 覆盖 Issue、PR、普通评论、审查与行内评论；飞书覆盖新根消息及已知旧话题的回复，并保留重叠窗口。首次飞书扫描登记全部可访问话题，显式配置回溯范围时记录实际覆盖；核对 `coverage`，不把范围外历史称为已检查。分页或上下文失败不推进成功读取位置。

摘要中的 `file` 保存完整来源与上下文，也可用 `intake show SOURCE EVENT_KEY` 读取。逐项查已有任务，保存任务关联、回复结果或明确处置后确认：

```sh
bun scripts/maintenance.ts intake ack feishu EVENT_KEY --task TASK_ID --note '已补入原任务并保存回复回执'
bun scripts/maintenance.ts intake ack github EVENT_KEY --note '重复反馈，关联原讨论链接并记录原因'
```

`--task` 必须是已存在任务；`--task`、`--note` 至少提供一个。读取成功只表示来源已进入持久化队列，不能直接标记已处理。未确认项跨轮次保留，存在未处理项时不报告“没有新反馈”；不要确认尚未读完或没有处置的来源。实施任务受阻仍照常读取、回应其他来源，每轮最多一个实施任务的限制不免除来源处理。

飞书读取使用已授权用户，回复使用已入群 Bot。所有 Bot 回复通过维护工具调用 `lark-cli im +messages-reply --reply-in-thread --idempotency-key`，不直接绕过 outbox 发送。确需回报时，阶段从 `接单`、`阻碍`、`审查完成`、`发布完成` 中选择，采用新消息回报状态变化：

```sh
bun scripts/maintenance.ts reply TASK 阻碍 --event STABLE_EVENT --text-file draft.txt
bun scripts/maintenance.ts reply TASK 阻碍 --event STABLE_EVENT --text-file draft.txt --send
```

首条命令只预览。`STABLE_EVENT` 标识确定的状态变化，如 `blocker-missing-scope` 或 `review-<SHA>`；同事件重试保持相同标识和正文，不随机生成或按执行次数变化。工具在原子锁内为新事件分配序号，生成 `<任务ID>-<阶段>-<序号>`；重复事件沿用已有 key，不因重试递增。发送前保存固定目标、正文、key 与 `sending`，成功保存 `sent` 和 `message_id`。查回执使用 `status`。

超时或响应不明记为 `unknown`，同一目标暂停后续发送；核对原话题的时间、Bot 身份和正文，确认后再人工登记回执。没有按 key 查询服务端的接口；服务端去重仅一小时，不能靠换序号或跨小时重试绕过未知结果。GitHub 回复及其他外部操作分别核对授权。

## 对外回复

在原话题里自然交流，直接回应对方关心的事，篇幅和形式随问题需要决定。主动同步有意义的新进展；有人提问或追问时正常回应，避免重复已经说清的内容。涉及修复、验证或发布时，准确区分已完成与待验证的部分，必要的依据附链接。

验收命令见[验证约定](../engineering/verification.md)。行为与契约变化同步更新所属领域文档，任务日志留在本机。

## 两个角色与反思记录

[反馈 Agent](prompts/feedback.md)统一处理两个渠道，跨渠道同一问题关联原任务，来源身份、回复目标与授权仍分别核对。子 Agent 实施不增加常驻角色；每次派工保存执行者和 worktree，重启先查执行者是否仍在工作，避免重复实施；找不到存活执行者时按 worktree 现场和任务记录恢复或重新派工。

[反思 Agent](prompts/reflection.md)每十二小时回看近期提交、任务和讨论，只更新[易误解点](understanding.md)、[人工待决](decisions.md)和[重复故障](recurring-failures.md)。保存上次已检查位置，无新发现不制造改动。发现代码故障交给已有反馈任务，不在反思会话平行实施。独立审查仍随每个任务进行。

可公开的长期依据写入相应主题；人工待决和私有证据保存到 runtime `control/daily-decisions.md`，未决判断不提升为规则。相关修复开始前读取这些记录，决定已明确后更新任务，防止重复提问。

两个会话每次唤醒核对原生周期任务的实际存活、创建时间和到期。按已安装 CLI 的 CronCreate/CronList 返回确认实际到期，在到期前一天去重重建本角色 job；保留交接和唯一 owner，避免静默停止。原生调度可能延迟，五分钟是补扫周期，不承诺准点响应。
