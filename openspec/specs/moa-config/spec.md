# moa-config 规格说明

## Purpose
定义 Mixture of Agents（MoA）配置的来源与解析行为。MoA 配置（`default_preset`、`reference_concurrency`、`presets`）唯一来源为 `~/.clickzetta/profiles.toml` 的顶层 `[moa]` 段，与 `[llm.*]` LLM entry 定义在同一文件，使 preset 中 `<entry>/<model>` 形式的模型引用与被引用的 entry 就近对齐。

## Requirements
### Requirement: MoA 配置从 profiles.toml 顶层 [moa] 读取

本需求 MUST 按以下场景执行。

MoA 配置 MUST 来自 `~/.clickzetta/profiles.toml` 的顶层 `[moa]` 段。全局配置文件（`czcli.json` / `opencode.json`）中的 `moa` 字段 MUST 被忽略，不参与 MoA provider 合成与运行时执行。

#### Scenario: profiles.toml 定义 [moa]

- **WHEN** `profiles.toml` 顶层含 `[moa]` 段，其 `presets` 中至少一个 preset 具备合法的 `aggregator` 和非空 `reference_models`
- **THEN** 解析结果携带该 `moa` 对象，合并进全局 config 的 `moa` 字段
- **AND** 该 preset 作为虚拟 `moa` provider 下的一个可选 model 出现在 model picker 中

#### Scenario: czcli.json 中的 moa 被忽略

- **WHEN** `czcli.json` 含 `moa` 字段，而 `profiles.toml` 无 `[moa]` 段
- **THEN** 全局 config 的 `moa` 字段为空
- **AND** 不合成任何 `moa` provider model

#### Scenario: 两处同时存在

- **WHEN** `czcli.json` 与 `profiles.toml` 都含 MoA 配置
- **THEN** 以 `profiles.toml` 顶层 `[moa]` 为准
- **AND** `czcli.json` 的 `moa` 字段被丢弃

### Requirement: [moa] 缺失或为空时不合成 MoA provider

本需求 MUST 按以下场景执行。

当 `profiles.toml` 没有 `[moa]` 段，或 `[moa]` 内没有任何合法 preset 时，解析层 MUST 返回空的 MoA 配置，不影响其余 LLM entry 的正常加载。

#### Scenario: 无 [moa] 段

- **WHEN** `profiles.toml` 只有 `[llm.*]` 而无 `[moa]`
- **THEN** 解析结果的 `moa` 为 undefined
- **AND** `[llm.*]` provider 与 default model 照常加载

#### Scenario: [moa] 内 preset 全部非法

- **WHEN** `[moa].presets` 中每个 preset 都缺 `aggregator` 或 `reference_models` 为空
- **THEN** 归一化后 presets 为空，不合成 `moa` provider
- **AND** 不因此中断 profiles.toml 的其余解析
