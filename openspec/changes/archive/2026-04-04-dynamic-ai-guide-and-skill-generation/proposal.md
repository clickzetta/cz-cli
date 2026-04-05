## Why

`cz_cli/main.py` 中 `_AI_GUIDE` 和 `cz_cli/skills/cz-cli/SKILL.md` 目前依赖手工维护，命令与示例在高频迭代后容易过时，已经出现“实现已变更但文档仍旧”的问题。该问题直接影响 AI Agent 的调用准确性，并持续增加维护成本。

## What Changes

- 将 `ai-guide` 从静态常量改为基于 Click 命令树的动态生成。
- 将技能文档从“全量手写命令列表”改为“固定模板 + 动态命令片段生成”。
- 为动态输出增加长度预算与裁剪策略，避免 ai-guide 过长（当前超万字符）。
- 统一命令签名来源，要求 `--help`、`ai-guide`、`SKILL.md` 三者保持同源一致。
- 将 skills 生成接入构建/打包链路，确保发布产物内技能内容与当前命令实现一致。
- 为生成的 skills 增加版本标识（至少包含 CLI 版本/生成器版本），便于排查漂移来源。
- 在 skills 固定模板中将安装前置规则 `pip3 install cz-cli  # Must be installed to use this skill` 提升为高可见提示。
- 评估并固定 `install-skills` 的兼容行为（目录结构、安装入口、回退策略）。

## Capabilities

### New Capabilities
- `skill-document-generation`: 提供基于 CLI 命令树动态生成技能命令段落的能力，支持固定模板注入、版本标识写入、打包阶段生成与安装兼容约束。

### Modified Capabilities
- `ai-guide`: 将命令、参数、示例从静态内容改为运行时生成，并增加输出长度控制与可读性分层策略。

## Impact

- Affected code:
  - `cz_cli/main.py`（删除 `_AI_GUIDE` 静态清单，新增动态构建入口）
  - `cz_cli/skills/cz-cli/SKILL.md`（改为模板化 + 动态生成产物）
  - 可能新增 `cz_cli/commands`/`cz_cli/` 下的文档生成模块（如 `guide_builder`）
  - 打包与发布相关配置（如 `pyproject.toml` / `Makefile` / `pyinstaller` 流程）用于接入 skills 生成
  - `install-skills` 相关逻辑（仅在接口或路径约束需要时调整）
- Tests:
  - 新增/修改 `ai-guide` 与 `SKILL.md` 生成一致性测试（与 `--help` 对照）
- Risks:
  - 动态生成引入格式漂移风险，需要稳定排序和快照测试
- Backward compatibility:
  - `cz-cli ai-guide` 命令入口不变；返回结构尽量保持兼容，新增字段需保持可选
