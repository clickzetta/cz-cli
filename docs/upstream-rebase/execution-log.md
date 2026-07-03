# 上游 rebase 执行日志 — 阶段 4（cz 深织点重打到 v1.17.9）

> 方法论见 `refactor/upstream-rebase-isolation` 分支的 `docs/upstream-rebase/design.md` §3-4。
> 本日志记录 A2 分支（`a2/upstream-base`，与 main 无共同祖先）上阶段 4 的实际落地。

## 范围

把 5 个深织点（rotation / billing / DB / prompt / 工具）按"opencode 当库用 + 类型化 Seam 派发 +
真插件 hook"的方法论重打到上游 opencode v1.17.9。目标：cz 核心行为在 v1.17.9 基底上跑通，上游
执行流文件的 cz 痕迹趋近"配置读取 + 单行品牌中立 seam"，typecheck 保持 25/25 绿 + 关键行为有测试兜底。

## 落地结果

| 深织点 | 方式 | 上游文件改动 | 隔离区 handler | 测试 |
|---|---|---|---|---|
| Seam 注册表（keystone） | 类型化 `SeamMap`（声明合并三元组 + 泛型 register/dispatch，fail-loud） | —（新建隔离区） | `clickzetta/seam/registry.ts` | 经 rotation/billing 间接覆盖 |
| rotation | Seam `session.retry.recover` + 真服务注入 | `retry.ts`(+29/-12 policy 加泛型 `recover?`)、`processor.ts`(+32 dispatch/latch/层补 Provider+Question)、`provider.ts`(+10 `invalidate()` seam) | `seam/rotation.ts` | `test/session/rotation-seam.test.ts`（6） |
| billing | Seam `provider.error.billing`（同步 `dispatchSync`） | `error.ts`(+28 dispatch + `userFacing?` 字段) | `seam/billing.ts` | `test/session/billing-semantic.test.ts`（6，钉签名漂移） |
| prompt | 真插件 `experimental.chat.system.transform` | `plugin/index.ts`(+5 注册 internal 插件) | `clickzetta/plugin/system-prompt.ts` | `test/clickzetta/system-prompt.test.ts`（3） |
| 工具 | builtin 列表单点织入 | `tool/registry.ts`(+7 import/yield/init/push) | 复用 `tool/job-performance.ts` | `test/tool/registry.test.ts`（+1 断言） |
| 入口 | `registerClickzettaSeams()` | `main.ts`(+4) | `seam/index.ts` | — |

**上游执行流文件 cz 痕迹总量**：7 文件、+103/-12 行、18 处 `cz_change` 标记（含多行注释块）。
全部品牌中立（无 `clickzetta` 业务逻辑泄漏进上游文件——上游只读配置/派发 seam，深织逻辑活在隔离区）。
纯上游 build（不调 `registerClickzettaSeams()`、不加载 cz 插件）下每个 seam 都是 no-op。

## 关键决策

### 第 0 问：DB gate —— 判定删除（不迁移）

main 的 `CLICKZETTA_MIGRATIONS` / `CLICKZETTA_DB` / `CLICKZETTA_DISABLE_CHANNEL_DB` 是建立在
`storage/db.ts`（SQLite 库 + drizzle migration）之上的离线 migration gate。**v1.17.9 已无 `storage/db.ts`**，
storage 重写为 `storage/storage.ts`（fs-based migrations，`MIGRATIONS[]`），main 的 gate 在新结构下无对应锚点，
大概率过时。

**判定：不迁移**（零 rebase 成本，最优）。验证若发现 cz 仍依赖离线 migration / `CLICKZETTA_DB`，
再在 `storage/storage.ts` 补 seam。当前阶段 4 的 rotation/billing/prompt/工具 均不依赖该 gate，跑通无碍。

### profile-label + PLAN_MODE 门控 —— 评估后定向延后

main 在 `session/prompt.ts:242` `insertReminders` 往**用户消息 parts**（非 system 数组）注入
`<system-reminder>Active ClickZetta profile: …`，并用 `Flag.CLICKZETTA_EXPERIMENTAL_PLAN_MODE` 门控 plan 提醒。

这属于**消息级 reminder**，与 system prompt（已走 `experimental.chat.system.transform` 真插件）是不同关注点。
v1.17.9 提供 `experimental.chat.messages.transform` hook（`session/prompt.ts:1307` / `compaction.ts:360` 已在用），
**可承载** profile-label 注入，但需把 `resolveCurrentProfileLabel` port 进 cz 侧。

**决策：定向延后**为有界后续项，走 `experimental.chat.messages.transform` 真插件，保持上游 `prompt.ts` 纯上游回退
（方法论要求）。阶段 4 核心（cz-cli-inner system prompt 经真插件注入 + 上游 system.ts/prompt.ts 纯净）已交付。

### Flag 收口 —— 阶段 4 无新增 CLICKZETTA_* flag

- 工具织入：main 即无 flag gate（builtin 无条件 yield）。整个 a2 build 即 cz 环境，无条件织入正确，无需 flag。
- prompt 门控：`CLICKZETTA_EXPERIMENTAL_PLAN_MODE` 随 profile-label 一并延后，本阶段不引入。

故阶段 4 实际落地**未新增任何 `core/flag/flag.ts` 依赖**（cz 痕迹更少，符合方法论"配置读取最小化"）。
后续 PLAN_MODE flag 落地时按 env-alias 方式（上游名优先 + cz 别名 shim，方法论 §7）补齐。

## 验证

- `bun turbo typecheck`：**25/25 全绿**（基线保持）。
- `bun test test/session/rotation-seam.test.ts`：6/6。证明 free-quota 429（`retryable()` 本判不可重试）
  经 seam 转成零延迟重试 + `provider.invalidate()` 被调；非 quota 4xx 不被重试（seam no-op）；轮换 latch 防重复。
- `bun test test/session/billing-semantic.test.ts`：6/6。ClickZetta billing 429 → userFacing 重写消息 + 不可重试；
  AI-gateway API-key 配额耗尽 → 标准配额消息；普通错误 no-op。语义钉死 `parseAPICallError` 签名漂移。
- `bun test test/clickzetta/system-prompt.test.ts`：3/3。system 数组含 cz-cli-inner，幂等不重复注入。
- `bun test test/tool/registry.test.ts`：13/13（含 `analyze_lakehouse_job` 织入断言）。
- 回归：`test/session/retry.test.ts` 33/33、`message-v2.test.ts` 全绿、`compaction.test.ts` 全绿
  （processor 加 Provider/Question 依赖后补 `Question.defaultLayer`）。

## Fail-loud 契约（已设计，未提交演示）

`SeamMap[K].requires` 通过 `dispatch` 的 R 通道传播：上游调用点缺服务则 typecheck 立刻红。
rotation 在 `processor.ts` 用 `Effect.provideService(Config/Provider/Question)` 本地放服务——漏一个即编译失败。
billing 的 `dispatchSync` 在类型层限定 `requires extends never`，保证同步调用点不会引入未满足的服务依赖。

---

# 阶段 5 — 完整 cz 功能盘点 + 补齐（parity sweep）

> 目标升级：让 a2 成为"完整 rebase（上游 opencode + origin/main cz 逻辑）+ 全部 cz seam 化"的完成态。
> 本节记录在阶段 4 五个深织点之外，对 origin/main 全部 81 个 cz-touched opencode 文件的功能盘点与补齐。

## 盘点方法

`origin/main` 与 a2 无共同祖先 → 按**内容**对比（非 git diff）。对 81 个 cz-touched 文件按"cz 行权重"排序，
逐一分类：WIRED / DEAD（存在但 0 引用）/ MISSING / FLAG（纯 flag 读，shim 覆盖）/ BRAND（纯品牌串）。

## 补齐结果（本阶段新增 seam / wiring）

| 功能 | main 锚点 | a2 修复前 | 落地方式 | 测试 |
|---|---|---|---|---|
| OTEL spans | `plugin/index.ts:130` 注册 OtelPlugin | DEAD（flushOtel 在，OtelPlugin 未注册） | internalPlugins 注册 | 冒烟 |
| Langfuse init | `plugin/index.ts:131` | DEAD（flush 在，init 未调） | main.ts cz 区调 init() | 冒烟 |
| traceparent 传播 | `provider.ts:1602`+`mcp/index.ts:316/328` | DEAD（util/traceparent 0 引用） | `outbound.headers` 同步 seam（target llm/mcp） | outbound-headers(4) |
| --profile 应用 | `run.ts:170`+`tui/thread.ts:139` | DEAD（clickzetta-profile 0 引用） | run.ts/tui.ts 声明 --profile + handler 调用 | apply-profile(3) |
| CLICKZETTA_* flags | `flag/flag.ts`（52 个改名） | MISSING（a2 纯 OPENCODE_*） | core/flag/flag.ts 单块 env-alias shim | flag-alias(3) |
| skill 排除 cz-cli | `skill/index.ts:95` | MISSING（无排除，会递归） | `skill.exclude` 同步 seam | transform-skill(2) |
| qwen prompt 缓存 | `transform.ts:332` applyClickZettaCaching | MISSING | `provider.transform.messages` 同步 seam | transform-skill(4) |

## 判定为"无需补齐"（已核实）

- **FLAG 类**（lsp/server DISABLE_LSP_DOWNLOAD/LSP_TY、instruction DISABLE_PROJECT_CONFIG、transform
  OUTPUT_TOKEN_MAX 等）：a2 读 `OPENCODE_*` / RuntimeFlags，**env-alias shim 已透明覆盖** CLICKZETTA_* 名。
- **BRAND/PATH 串**（config/managed plist `ai.clickzetta.managed`、config/paths `.clickzetta`、help 文案、tui brand）：
  方法论刻意最小化的品牌中立面，非功能逻辑，不补。
- **auth/index、control-plane/workspace、sync/index、share/***：仅 flag 读或品牌串，无 cz 专属逻辑。
- WIRED 且完整：provider/clickzetta(19 引用)、config/profiles-llm(3)、llm-quota-recovery(2)、
  config-llm（`agent llm` 命令）、setup(14)、update/bootstrap(17)、job-performance（阶段4已织入）。

## 已知遗留（低优先，文档记录）

- **czcli.json 运行时配置加载**：main `config.ts` loadFile 读 `~/.clickzetta/czcli.json[c]` 合入 live Config。
  a2 仅在 bootstrap 用它做 config-dir 发现 + 在 `CLICKZETTA_MIGRATE_PROFILES_ONLY` 路径迁移，**未在运行时
  config 加载链合入**。判定：czcli.json 是 **legacy** 配置名（注释明确），现行 canonical 是 profiles.toml
  `[llm.clickzetta]`（a2 经 profiles-llm 已加载）。低优先，留待确有 legacy 用户时补 config-paths seam。
- **CLICKZETTA_CONFIG_DIR 指令路径**：main instruction.ts 用 CONFIG_DIR 定位 AGENTS.md。a2 读
  `OPENCODE_DISABLE_PROJECT_CONFIG`（shim 覆盖）但未处理 CONFIG_DIR 的 AGENTS.md 路径分支。niche。
- **langfuse.traceGeneration() 深织**：main 在 `prompt.ts` 生成后读 message parts 上报 Langfuse generation。
  a2 已 init+flush，但**未接 traceGeneration 调用**（生成级 trace 缺失）。最佳设计应走 EventV2 订阅而非织 prompt.ts，
  列为 task 10 邻域的后续项。

## 阶段 5 度量

新增隔离区 seam handler 3 个（outbound-headers / skill-exclude / message-transform），复活 dead 文件 2 个
（traceparent / clickzetta-profile）。上游单行 seam/wiring：plugin/index、main.ts、provider.ts、mcp/index.ts、
run.ts、tui.ts、core/flag/flag.ts、skill/index.ts、transform.ts，全部品牌中立 cz_change。typecheck 保持 25/25。

## 未完成（goal 剩余）

- **task 10**：profile-label（`<system-reminder>Active ClickZetta profile`）+ PLAN_MODE 门控，走
  `experimental.chat.messages.transform` 真插件，保持上游 prompt.ts 纯净。
- **task 12**：上游基底 v1.17.9 → 最新 stable v1.17.11（599 commit 漂移，孤立快照，需重新快照 + 重锚 seam）。

---

# 阶段 6 — task 10 落地 + 上游基底 bump v1.17.9 → v1.17.11

## task 10：profile-label + PLAN_MODE（已落地）

- profile-label：v1.17.9 把 reminder 收进上游 `SessionReminders` 模块，故不再织 prompt.ts，改用真插件
  `ClickzettaProfileReminderPlugin`（`experimental.chat.messages.transform`，prompt.ts:1307 触发），
  往最后一条 user message 追加 `<system-reminder>Active ClickZetta profile: …`（标签来自 `resolveCurrentProfileLabel`）。
- PLAN_MODE：v1.17.9 的 `SessionReminders` 原生处理 plan/build 提醒；`CLICKZETTA_EXPERIMENTAL_PLAN_MODE`
  由 flag env-alias shim 透明覆盖（经 RuntimeFlags effect Config 验证 `experimentalPlanMode` 解析正确）。
- 健壮性：main.ts 顶部 side-effect import `@opencode-ai/core/flag`，保证 shim 在任何 flag 读取（含运行时 lazy
  effect Config）之前先跑。

## 上游 bump 机制（关键）

opencode 的 release tag 是**孤立快照**（v1.17.9 与 v1.17.11 无共同祖先），故"rebase 到最新"≠git rebase。
但 **v1.17.9 是 a2 的真实祖先**，所以正确机制是**强制 v1.17.9 为 base 的三方合并**：
`git merge-tree --merge-base=v1.17.9 a2/upstream-base v1.17.11`。

- seam 锚点漂移极小：13 个锚点中 **8 个 v1.17.9→v1.17.11 完全未变**（retry/processor/error/registry/
  plugin-index/llm-request/transform/skill），仅 5 个变（provider/run/tui/mcp/prompt）。993 文件的总差异大多是生成物。
- 合并仅 **3 处冲突**：bun.lock（取 v1.17.11 lock 后 `bun install` 重新协调 cz 依赖）、tui.ts（cz `--profile`
  option vs 上游新增 mini/replay/demo，两者皆留）、mcp/index.ts（cz Seam import vs 上游新增 McpEvent import，两者皆留）。
- v1.17.11 新增 6 个 workspace 包（schema/protocol/client/session-ui/sdk-next/httpapi-codegen），typecheck 任务从 25 → 31。
- 修一处类型回归：v1.17.11 新增 `runMini` 构造 args 字面量传给 `RunCommand.handler`，cz 加的 `--profile` option
  令推断类型多一字段 → 补 `profile: undefined`。

## bump 暴露的潜伏缺陷（阶段4起就有，已修）

cz 的 `system-prompt` / `profile-reminder` 插件在 `internalPlugins()` 里**无条件注册**，会在**上游 recorded-fixture
测试**里也注入 cz-cli-inner / profile-reminder，破坏 fixture 匹配（`native-*-tool-loop`）。seam 用注册门控（测试里不调
`registerClickzettaSeams` 故 no-op），但插件缺等价门控。修复：新增 `clickzetta/runtime.ts` 的 `CLICKZETTA_RUNTIME`
标记（在 `registerClickzettaSeams` 里 `markClickzettaRuntime()`，cz 入口才设），两个插件 hook 内 `isClickzettaRuntime()`
门控。语义正确："cz 注入只在 cz agent 真跑时发生"。测试用 beforeAll/afterAll 按文件作用域设/还原标记，避免同进程跨文件泄漏。

## 阶段 6 度量 / 最终状态

- `a2/upstream-base` 现已 fast-forward 到 v1.17.11（含全部 cz seam + 插件 + 运行时门控）。
- `bun turbo typecheck`：**31/31 全绿**。
- 全量回归（session/provider/skill/tool/clickzetta）：**1098 pass / 0 fail**（recorded-fixture 测试恢复绿）。
- cz 行为测试：rotation(6)/billing(6)/outbound-headers(4)/apply-profile(3)/profile-reminder(3)/
  system-prompt(3)/transform-skill(6)/flag-alias(3) 全绿。


