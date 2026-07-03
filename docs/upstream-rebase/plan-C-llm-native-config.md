# 方案 C — LLM 配置移到 opencode 原生 `opencode.json`（真·零 config 嵌入）

> 状态：**方案（未动代码）**。目标：让 opencode 原生加载 cz 的 LLM 配置，彻底消除
> config 注入（无 seam、无运行时转换、无派生文件）。连接配置（`[profiles.*]`）留在
> `profiles.toml`，职责分离。

## 1. 为什么是 C

cz 的 `[llm.*]` 本质就是 opencode 原生 `provider` 配置的 TOML 方言。A（一行 seam）和 B2
（启动写派生文件）都得在运行时"翻译"。C 直接让 LLM 配置**以原生格式存在 opencode 读的位置**，
数据不再需要翻译 → opencode 加载路径里 0 行 cz 代码。

## 2. 已核实的事实

- opencode 全局 config 路径 = `~/.config/opencode/`（`Global.Path.config`，XDG）。原生加载
  `config.json` / `opencode.json` / `opencode.jsonc`（`config.ts:258-260`）。
- 原生 provider 形态 = `config.provider.<id> = { npm?, name?, options:{apiKey,baseURL,...}, models? }`；
  默认模型 = `config.model = "<providerID>/<modelID>"`（`ConfigProviderV1.Info`）。
- 原生写 API：`Config.updateGlobal(info)`（merge-deep + JSONC-aware，`config.ts:636`）—— 供
  opencode 包内 Effect 上下文用。
- `default_llm` 运行时**唯一**作用 = 经 `parseProfilesToml` 映射成 `config.model`。无其他运行时消费者
  → 等价物就是原生 `config.model`。
- `[llm.*]` 读写面（11 文件 / 2 包）：
  - opencode 包：`config/profiles-llm.ts`（解析）、`cli/cmd/config-llm.ts`（agent llm 命令）、
    `cli/cmd/setup.ts`、`main.ts`（迁移）、`session/llm.ts`、`plugin/otel/*`。
  - cz-cli 包（已发布）：`llm/clickzetta-rotation.ts`（轮换写新 key）、`commands/agent.ts`、
    `commands/setup.ts`、`commands/ai-gateway.ts`。
- `agent llm` 子命令：list / show / add / test / use / remove / reset / purge-legacy。

## 3. 目标终态

| 数据 | 位置（之前 → 之后） |
|---|---|
| LLM provider + 默认模型 | `~/.clickzetta/profiles.toml [llm.*]` + `default_llm` → **`~/.config/opencode/opencode.json` 的 `provider` + `model`** |
| ClickZetta 连接配置 | `~/.clickzetta/profiles.toml [profiles.*]`（不变） |

- opencode 启动：原生读 `opencode.json` 的 provider/model → **删 config.contributions seam + materialize + main.ts 那段**。
- `agent llm add/use/remove/...`：直接读写 `opencode.json`。
- 轮换：写新 provider 进 `opencode.json` + 设 `model`。

## 4. 关键设计决定

1. **统一写入助手**：新建 `clickzetta/native-config.ts`（隔离区），封装"读/合并/写
   `~/.config/opencode/opencode.json` 的 provider/model"，纯 fs（不依赖 Effect），供 opencode
   命令侧 + cz-cli 包共用同一套路径与格式。**这是唯一新增的 cz 代码，且在隔离区。**
   - 注意 XDG：路径解析要复用 opencode 的 `Global.Path.config` 逻辑（`xdgConfig`），不能写死
     `~/.config`（尊重 `XDG_CONFIG_HOME`）。
2. **provider id = entry name**（沿用现状语义，如 `clickzetta` / `my-relay`）。
3. **clickzetta entry**：仍走 `CLICKZETTA_PROVIDER_ENTRY`（npm=openai-compatible、models 目录）+
   baseURL 兜底网关 URL（保留本轮 `isClickzettaGatewayUrl` 识别，rotation/traceparent 不变）。
4. **`_providerType` 已删**（本轮成果，保留）。

## 5. 文件级改动清单

### opencode 包
- `config/config.ts`：**无改动**（C 的核心红利——彻底不碰）。
- `clickzetta/seam/config-contributions.ts` + 测试：已删（本轮）。保持删除。
- `main.ts`：**删** `materializeClickzettaConfig` 调用那段（B2 残留）。
- `config/profiles-llm.ts`：
  - `parseProfilesToml` / `loadClickzettaConfigContributions` / `materializeClickzettaConfig`：
    LLM 解析职责**迁出**。保留的只有 `migrateLegacyClickzettaConfig`（profiles 内 legacy 字段）
    和 profile-label 相关（`resolveCurrentProfileLabel` 等连接侧）。
  - 新增/移走：把"entry → 原生 provider 形态"的投影逻辑（`providerFromEntry` / `customProviderFromEntry`）
    搬进 `clickzetta/native-config.ts`，因为它现在服务"写 opencode.json"而非"运行时转换"。
- `cli/cmd/config-llm.ts`（agent llm 命令）：读写目标 `profiles.toml [llm.*]` → `opencode.json`
  provider/model（经 native-config 助手）。8 个子命令逐个改。
- `cli/cmd/setup.ts`：写 `[llm.clickzetta]` → 写 opencode.json clickzetta provider。

### cz-cli 包（已发布，需发版）
- `llm/clickzetta-rotation.ts`：`writeRotatedKey` 从写 `profiles.toml llm[name]` + `default_llm`
  → 写 `opencode.json` provider[name] + `model`。
- `commands/agent.ts` / `commands/ai-gateway.ts` / `commands/setup.ts`：同步读写目标。

### 迁移（一次性）
- `main.ts` 启动早期：若 `profiles.toml` 仍有 `[llm.*]` 且 opencode.json 无对应 provider →
  搬过去（写 opencode.json）→ 从 profiles.toml 删除 `[llm.*]` + `default_llm`（或标记已迁移）。
  幂等、只跑一次。复用 `CLICKZETTA_MIGRATE_PROFILES_ONLY` 那条已有迁移通道的模式。

## 6. 执行顺序（每步独立提交 + 可验证）

1. **native-config 助手**：新建 `clickzetta/native-config.ts`（读/合并/写 opencode.json，XDG-aware，
   entry→provider 投影）。+ 单元测试。**不接线**。
2. **迁移器**：`main.ts` 启动早期 profiles.toml `[llm.*]` → opencode.json，幂等。+ 测试。
3. **agent llm 命令切换**（opencode 包 config-llm.ts + setup.ts）：读写改 native-config。+ 命令测试。
4. **cz-cli 包切换**（rotation + agent/ai-gateway/setup）：写目标改 opencode.json。+ 测试。
5. **拆除注入残留**：删 main.ts 的 materialize 调用、profiles-llm 的 LLM 解析导出、
   `loadClickzettaConfigContributions`/`materializeClickzettaConfig`。确认 config.ts 干净。
6. **全量验证**：typecheck 31/31；cz 套件 + config 回归；端到端冒烟（setup → opencode 原生加载
   provider → 选模型 → 轮换写 opencode.json）。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 动已发布 `@clickzetta/cli` 包（轮换） | 步骤 4 单独提交；与发版协调；native-config 助手两包共用降低分叉 |
| 存量用户 `[llm.*]` 迁移出错/丢配置 | 迁移器幂等 + 迁移前不删原文件（先写 opencode.json 成功再清 `[llm.*]`）；保留备份 |
| XDG 路径不一致（`~/.config` vs `XDG_CONFIG_HOME`） | native-config 复用 opencode 的 `Global.Path.config` 解析，不写死 |
| opencode.json 已有用户手写 provider 同名冲突 | 写入用 merge（provider 按 key 合并），cz 写自己的 key，不覆盖用户其它 key |
| 优先级：cz 写的是 global opencode.json，用户项目级 opencode.json 仍能覆盖 | 符合预期（项目 > 全局），与原生语义一致 |

## 8. C 完成后的最终嵌入度

- opencode **config 加载路径**：cz 代码 **0 行**（数据原生）。
- 残留 seam（与 config 无关的运行时行为）：rotation recover、billing、traceparent、skill-exclude、
  message-transform —— 这些是执行流行为，不在本方案范围。
- cz LLM 逻辑全部收敛到：`clickzetta/native-config.ts`（隔离区助手）+ 各命令调用它。

## 9. 待你拍板

- 确认走 C 全量（6 步）？还是先做 1-3（opencode 包侧，不动已发布的 cz-cli 包，轮换暂留旧路径）
  作为第一阶段，cz-cli 包改动作为第二阶段单独发版？
