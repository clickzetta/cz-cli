# MoA (Mixture of Agents) 使用指南

MoA 让多个「参考模型」并行给出建议，再由一个「聚合模型」综合这些建议、执行工具并产出最终答案。你像选普通模型一样，在 `/model` 里选择它即可使用。

## 一、它是什么

- **参考模型（reference）**：一到多个模型并行运行，各自给出带策略的文字建议。它们**只看到可用工具的清单（名字+简述），不执行工具**。
- **聚合模型（aggregator）**：真正干活的模型。它拿到所有参考模型的原始建议后，作为正常的 acting model 一次性消化——带完整工具 schema、执行工具、多轮迭代、流式输出，与任何普通模型调用一致。
- **不是新命令**：MoA 注册成一个**虚拟 model provider**，每个 preset 是它下面的一个可选 model。`/model`、model picker、config 全部照常工作。

## 二、快速开始

### 1. 编辑配置文件

MoA 配置写在 `~/.clickzetta/profiles.toml` 的**顶层 `[moa]` 段**里，和你的 `[llm.*]` LLM 配置在同一个文件。这样 preset 里引用的模型（`<llm entry 名>/<model>`）与被引用的 `[llm.*]` entry 就在一起，一目了然。

> ⚠️ MoA 只从 `profiles.toml` 的顶层 `[moa]` 读取。写在 `czcli.json` / `opencode.json` 里的 `moa` 字段会被**忽略**。

在 `~/.clickzetta/profiles.toml` 里加一个 `[moa]` 段：

```toml
[moa]
default_preset = "default"
reference_concurrency = 8

[moa.presets.default]
reference_models = ["clickzetta/anthropic/claude-sonnet-4.6"]
aggregator = "clickzetta/anthropic/claude-sonnet-4.6"
```

### 2. 重启 cz-cli，选择模型

1. 启动（或重启）cz-cli TUI
2. 输入 `/model`（**不是** `/moa`——MoA 不是斜杠命令）
3. 在列表底部的 **"Mixture of Agents"** 分组下选择 **`MoA: default`**
4. 正常提问即可

## 三、model 字符串怎么写（重要）

MoA 里 `reference_models` 和 `aggregator` 的 model 字符串，**必须带完整的 provider 前缀**，格式为 `<provider>/<model>`。

系统按**第一个 `/`** 拆分 provider 和 model：

- `clickzetta/anthropic/claude-sonnet-4.6`
  → provider = `clickzetta`，model = `anthropic/claude-sonnet-4.6`

怎么确定该写什么？看 `/model` 列表里模型所在的**分组名**就是 provider：

| `/model` 里看到的 | 应该写的 slot |
|---|---|
| `clickzetta` 分组下的 `anthropic/claude-sonnet-4.6` | `clickzetta/anthropic/claude-sonnet-4.6` |
| `uat_tencent` 分组下的 `DeepSeek V4 Flash` | `uat_tencent/deepseek/deepseek-v4-flash` |

provider 名来自你 `profiles.toml` 里 `[llm.<名字>]` 的名字；model id 是该 provider 下模型的真实 id（注意 clickzetta 的 model id 本身就含 `/`）。

**前提条件**：MoA 的 aggregator/reference 引用的模型，必须是已经在 `/model` 里能选到、且**在你的环境里能正常调用**的模型。如果某个模型直连都调不通（超时 / 400 `GATEWAY_NO_UPSTREAM_CANDIDATES`），用它做 aggregator 也不会有产出。

## 四、配置字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `default_preset` | 否 | 默认使用的 preset 名 |
| `reference_concurrency` | 否 | 参考模型的最大并行数，默认 8 |
| `presets.<名字>.reference_models` | **是** | 一到多个参考模型，`provider/model` 形式，至少 1 个 |
| `presets.<名字>.aggregator` | **是** | 聚合模型（真正执行工具的 acting model），`provider/model` 形式 |
| `presets.<名字>.enabled` | 否 | 设为 `false` 时跳过参考模型 fan-out，聚合模型单独行动 |
| `presets.<名字>.max_tokens` | 否 | 参考模型的输出上限；不设则用模型最大值 |

## 五、多视角配置示例

真正的 MoA 价值在于**不同**的参考模型给出多个视角。当你有多个可用模型时，可以这样配：

```toml
[moa]
default_preset = "balanced"

[moa.presets.balanced]
reference_models = [
  "uat_tencent/qwen/qwen3.6-flash",
  "uat_tencent/deepseek/deepseek-v4-flash",
]
aggregator = "clickzetta/anthropic/claude-sonnet-4.6"
```

上例：qwen 和 deepseek 并行给建议，claude 综合它们的要点产出最终答案并执行工具。

> 只用一个模型同时做 reference 和 aggregator 也能工作，但多视角效果有限——参考模型和聚合模型用**不同**模型才更能体现 MoA 的价值。

## 六、常见问题

**Q：`/model` 里看不到 MoA？**
- 确认 MoA 配置写在 `~/.clickzetta/profiles.toml` 的顶层 `[moa]` 段里（写在 `czcli.json` / `opencode.json` 会被忽略）。
- 配置改动后需要**重启** cz-cli 才会重新加载。
- 确认 `aggregator` 引用的模型能在 `/model` 里找到——如果聚合模型不存在，该 preset 会被跳过，MoA 就不会出现。

**Q：选了 MoA 但没有输出？**
- 检查 `aggregator` 模型在你的环境里能否单独正常对话。聚合模型是 acting model，它调不通整轮就没有产出。

**Q：某个参考模型报错了会怎样？**
- 单个参考模型解析/调用失败会降级为 `[failed: ...]`，不中断整轮；若全部参考模型都失败，聚合模型会独立行动。

**Q：`/moa` 没反应？**
- MoA 不是斜杠命令，是虚拟模型。请用 `/model` 选择，而不是输入 `/moa`。
