# 维护工作流程

遵守根 [AGENTS.md](../../AGENTS.md)。使用 `gh` 读取 GitHub、`lark-cli` 读取目标群；命令与身份用各自 `--help`、内置资料核对。

## 本机记录

三个会话通过 `git rev-parse --git-common-dir` 定位同一公共 Git 目录，继续使用其中的 `cz-maintenance/`。在仓库根目录运行 `bun scripts/maintenance.ts init` 整理旧任务索引，再用 `status` 查看任务和实际授权。旧 `state.json`、`config.json`、游标、任务记录与 worktree 原样保留，新进度和来源映射保存到 `native-state.json`；旧执行器与间隔字段不参与原生调度。

授权唯一来源为该目录的 `config.json.permissions`，每轮重新读取：现有 `postLark: true`，`push`、`createPullRequest`、`postGithub`、`merge`、`release` 均为 `false`。不得通过文档或工具默认值扩大权限；Bot 回复限定于配置绑定的原群原话题。

首次接手必须读取 `native-handoff.md` 并列出旧 `needs_attention`：PR 132、131、130、126、101、70、45、43、133 与两条飞书反馈。旧 ID、worktree 和来源映射继续使用；新来源先查询索引，不能因新旧 ID 格式不同重复建单。当前没有历史发送回执，`outbox/` 从零建立。

每项任务保存来源、验收条件、owner、worktree、`baseSha`、`headSha`、`reviewedSha`、验证、审查结论、外部动作、阻碍与下一步。GitHub 与飞书指向同一问题时关联到已有任务。

用 `task github:<owner>/<repo>:<编号>` 或 `task lark:<chat_id>:<message_id>` 查已有任务；`register ITEM.json` 按来源去重接单，`save TASK.json` 保存进度，均接在 `bun scripts/maintenance.ts` 后。任务正文与临时 JSON 留在本机。

## 推进一项任务

1. 核对当前配置、`native-handoff.md`、工具列出的旧任务与来源最新上下文。用稳定来源键查询旧 ID，再认领或注册任务；来源有更新时补充已有任务，不另建重复任务。
2. 在 `claims/` 下原子创建该任务的目录，成功后记录 owner；已存在或归属不明时不接管。各会话只修改自己持有的任务与控制记录，不抢占未对账的认领。
3. 新修复从更新后的 `origin/main` 精确 SHA 创建独占 worktree，记录 `baseSha` 并确认该版本包含维护规则。PR 审查保留 PR head 和实际 merge-base；历史跨度异常时先交接，不直接移植整段差异。接手历史任务先核对现场与副作用。
4. 实施完成后在 loop 会话中派新的审查子 Agent，只提供最终 diff、SHA、验收条件、验证日志及源码入口，不提供实施者总结，也不继承其实施对话。审查者可读取源码和相关契约，结论与实际 `reviewedSha` 写入任务记录；审查后任何源码变化都重做审查。审查失败可返修，保留真实失败。
5. 每轮最多推进一个实施任务，审查与返修属于同一任务。完成本轮工作或遇到需要用户决策、授权的阻碍时，保存交接并结束，不连续开新任务。owner 完成交接且没有执行者继续写入后才释放认领。

## 来源与回报

GitHub 首轮核对现有 open Issue 与 PR，后续读取更新。飞书首轮按配置范围回溯，后续增量读取并保留重叠窗口，补齐话题根消息。分页或上下文未完成时记录缺口，不越过未处理范围推进成功游标。

飞书读取使用已授权用户，回复使用已入群 Bot。所有 Bot 回复通过维护工具调用 `lark-cli im +messages-reply --reply-in-thread --idempotency-key`，不直接绕过 outbox 发送。阶段固定为 `接单`、`阻碍`、`审查完成`、`发布完成`，采用新消息回报状态变化：

```sh
bun scripts/maintenance.ts reply TASK 阻碍 --event STABLE_EVENT --text-file draft.txt
bun scripts/maintenance.ts reply TASK 阻碍 --event STABLE_EVENT --text-file draft.txt --send
```

首条命令只预览。`STABLE_EVENT` 标识确定的状态变化，如 `blocker-missing-scope` 或 `review-<SHA>`；同事件重试保持相同标识和正文，不随机生成或按执行次数变化。工具在原子锁内为新事件分配序号，生成 `<任务ID>-<阶段>-<序号>`；重复事件沿用已有 key，不因重试递增。发送前保存固定目标、正文、key 与 `sending`，成功保存 `sent` 和 `message_id`。查回执使用 `status`。

超时或响应不明记为 `unknown`，同一目标暂停后续发送；核对原话题的时间、Bot 身份和正文，确认后再人工登记回执。没有按 key 查询服务端的接口；服务端去重仅一小时，不能靠换序号或跨小时重试绕过未知结果。GitHub 回复及其他外部操作分别核对授权。

验收命令见[验证约定](../engineering/verification.md)。行为与契约变化同步更新所属领域文档，任务日志留在本机。
