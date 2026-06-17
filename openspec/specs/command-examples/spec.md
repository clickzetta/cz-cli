# command-examples 规格说明

## Purpose
约束 cz-cli 命令 help 中的 Examples。旧 Python 版本要求 Click command object 携带 examples；当前 TypeScript 版本使用 yargs `.example()` 或共享 guide metadata 表达同一契约。

## Requirements
### Requirement: 示例靠近命令定义维护

本需求 MUST 按以下场景执行。

每个非平凡命令 SHOULD 在定义附近维护 examples，避免集中手写清单与实际参数漂移。

#### Scenario: 命令定义包含示例

- **WHEN** 开发者修改 `packages/cz-cli/src/commands/*.ts` 中的命令参数
- **THEN** SHOULD 同步更新同文件附近的 `.example()` 或共享 metadata
- **AND** 示例必须可按当前 help 参数执行

#### Scenario: 命令无需示例

- **WHEN** 命令是内部、隐藏或明显的叶子命令
- **THEN** 可以省略 examples
- **AND** help 与指南生成不能因为缺少 examples 失败

### Requirement: help 输出展示 Examples

本需求 MUST 按以下场景执行。

有示例的命令 MUST 在 `--help` 输出中展示 Examples 区块。

#### Scenario: sql 有示例

- **WHEN** 用户执行 `cz-cli sql --help`
- **THEN** help 输出包含 Examples
- **AND** 示例使用 `cz-cli sql ... --format ...` 或当前可用参数

#### Scenario: 没有示例的命令

- **WHEN** 用户执行某个没有 examples 的命令 help
- **THEN** help 可以不展示 Examples
- **AND** 不输出空标题或占位符

### Requirement: 示例必须体现当前输出参数

本需求 MUST 按以下场景执行。

所有示例 MUST 使用 `--format`，不得继续使用 `-o` 或 `--output`。

#### Scenario: JSON 示例

- **WHEN** 文档需要展示 JSON 输出
- **THEN** 示例使用 `--format json`
- **AND** 若示例展示 agent runtime 命令，格式值必须来自该命令 help

#### Scenario: 迁移旧示例

- **WHEN** 从 Python spec 迁移旧 `-o json` 示例
- **THEN** 迁移结果 MUST 改写为 `--format json`
- **AND** 不保留旧参数作为推荐用法
