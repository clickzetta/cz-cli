# agent-guide 规格说明

## Purpose
迁移 Python 版本 `ai-guide`、skill 文档生成、命令示例和 TOON 压缩相关规格。当前仓库不再提供顶层 `cz-cli ai-guide` 命令；AI 可消费命令元数据由 `packages/cz-cli/src/guide-builder.ts` 和捆绑/外部 skill 文档承担。

## Requirements
### Requirement: AI 指南来自共享命令元数据

本需求 MUST 按以下场景执行。

系统 SHOULD 通过共享的命令元数据生成 AI 指南和 skill 命令清单，避免手写多份命令库存。

#### Scenario: 命令定义变更

- **WHEN** 某个 yargs 命令的名称、用法、选项或示例发生变化
- **THEN** AI 指南和生成的 skill 命令清单 SHOULD 从同一元数据源反映该变化
- **AND** 不要求维护独立的 Python `_AI_GUIDE` 或 Click registry

#### Scenario: 旧 ai-guide 命令被调用

- **WHEN** 用户或脚本调用已废弃的 `cz-cli ai-guide`
- **THEN** CLI SHOULD 返回明确的 usage error 或迁移提示
- **AND** 提示用户改用当前 skill 文档、`cz-cli <command> --help` 或内部 guide 生成入口

### Requirement: 命令条目包含可执行用法

本需求 MUST 按以下场景执行。

AI 指南中的每个非根命令条目 MUST 包含命令路径、类型、说明和用法签名。

#### Scenario: 读取 Lakehouse 命令清单

- **WHEN** agent 读取生成的命令清单
- **THEN** `sql`、`schema`、`table`、`workspace`、`status`、`profile`、`task`、`runs`、`attempts`、`agent`、`job`、`setup`、`update`、`datasource`、`ai-gateway`、`analytics-agent` 等命令均可发现
- **AND** 每个命令条目包含 `kind`，值为 `group` 或 `command`

#### Scenario: 命令没有示例

- **WHEN** 某命令尚未定义 examples
- **THEN** 生成过程 MUST 省略 examples 或使用空数组
- **AND** 不得因此失败或输出 null 污染

### Requirement: 示例与 help 输出一致

本需求 MUST 按以下场景执行。

非平凡命令组和叶子命令 SHOULD 在 help 中展示可直接复制的 Examples。

#### Scenario: sql help 展示读写示例

- **WHEN** 用户执行 `cz-cli sql --help`
- **THEN** Examples 中 SHOULD 包含只读查询、`--write` 写入、文件输入、变量替换或异步查询示例

#### Scenario: task help 展示常用工作流

- **WHEN** 用户执行 `cz-cli task --help` 或关键子命令 help
- **THEN** help SHOULD 展示创建、保存内容、部署、执行或依赖解析的示例
- **AND** 示例 MUST 使用当前命令名和 `--format`，不得使用 Python 时代的 `-o`

### Requirement: 指南输出预算可控

本需求 MUST 按以下场景执行。

生成的 AI 指南 SHOULD 有长度预算，优先保留命令签名、安全规则、分页/确认契约和输出格式说明。

#### Scenario: 内容超过预算

- **WHEN** 生成内容超过配置预算
- **THEN** 系统先裁剪低优先级描述、示例或参数详解
- **AND** 输出包含 machine-readable truncation metadata

#### Scenario: 宽模式生成

- **WHEN** 调用方明确请求宽模式或更大预算
- **THEN** 系统 MAY 保留更多选项和示例细节
- **AND** 仍 MUST 保留 mandatory sections

### Requirement: skill 文档生成与分发解耦

本需求 MUST 按以下场景执行。

skill 文档生成负责内容一致性，安装分发由 `skill-install` 规格约束。

#### Scenario: 构建包包含 skill

- **WHEN** release 构建打包 `skills/cz-cli/SKILL.md`
- **THEN** 内容 SHOULD 反映当前命令清单和 onboarding 指引
- **AND** 安装脚本负责注册到内置和外部 agent skill 目录

#### Scenario: skill 文档过期

- **WHEN** 生成器检测到命令清单与提交的 skill 文档不一致
- **THEN** drift check SHOULD 失败并提示重新生成
- **AND** 不能静默发布过期命令说明
