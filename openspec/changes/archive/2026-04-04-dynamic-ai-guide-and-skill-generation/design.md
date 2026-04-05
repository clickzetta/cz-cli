## Context

`ai-guide` 目前由 `cz_cli/main.py` 中静态 `_AI_GUIDE` 常量维护，`SKILL.md` 也包含大量手写命令清单。命令参数和语义在迭代中频繁变更，静态内容极易滞后，导致 AI 依据过期信息调用命令。

该变更是跨模块改造：涉及 CLI 命令注册、帮助文本提取、ai-guide 渲染、skills 文档渲染和测试基线。核心目标是把命令文档统一下沉到“命令入口定义 + help/introspection”这一单一事实源。

## Goals / Non-Goals

**Goals:**
- 删除 `_AI_GUIDE` 静态命令清单，改为运行时动态构建。
- `SKILL.md` 改为“固定模板 + 动态命令片段”模式，避免重复维护。
- 统一 `--help` / `ai-guide` / `SKILL.md` 三方签名来源与排序规则。
- 为 `ai-guide` 增加长度预算机制，避免超长输出并保持关键信息可用。
- 在 build/package 流程中自动生成 skills，保证发布产物与命令实现同版本。
- 为生成的 skills 注入可追踪版本标识（CLI 版本 + 生成器版本）。
- 提升 `pip3 install cz-cli  # Must be installed to use this skill` 的可见性为模板固定高亮规则。
- 明确 `install-skills` 在动态生成后仍可用且行为兼容。
- 提供回归测试，验证命令签名一致性与稳定性。

**Non-Goals:**
- 不重构 Click 命令业务逻辑本身（仅文档生成路径）。
- 不改变现有命令行为、返回数据语义与认证机制。
- 不引入远端文档服务或网络依赖。

## Decisions

### 1) 引入统一命令元数据构建器（单一事实源）
- 决策：新增内部构建器（如 `cz_cli/guide_builder.py`），通过 Click command tree introspection 提取：命令路径、usage、参数、帮助文本、默认值。
- 原因：命令入口和参数定义本来就在 Click 对象内，动态提取可以消除手工同步。
- 备选方案：继续手工维护 `_AI_GUIDE` 并增加 lint 检查。被拒绝，因为仍存在人工遗漏窗口。

### 2) ai-guide 输出采用“分层输出 + 长度预算”
- 决策：ai-guide 固定输出核心块（global options / command inventory / safety / pagination / confirmation），对示例和冗长字段按预算裁剪，并在输出中带上 `truncated=true` / `budget_used` 信息。
- 原因：当前 ai-guide 文本过长，影响 AI token 成本与可读性。
- 备选方案：硬编码缩短示例。被拒绝，因为仍需人工维护且无法适应命令增长。

### 3) SKILL 文档模板化 + 动态片段渲染
- 决策：保留 SKILL 固定说明段（定位、原则、注意事项），命令区由构建器按分组动态渲染。
- 原因：减少重复维护并与 ai-guide 共享数据源。
- 备选方案：完全自动覆盖整份 SKILL。被拒绝，因为固定描述需要人工可控语气与边界声明。

### 4) 统一排序与稳定化策略
- 决策：命令路径按字典序稳定排序；选项按 Click 声明顺序输出；示例统一引用 canonical usage。
- 原因：降低 snapshot 测试抖动和发布 diff 噪音。

### 5) 构建阶段生成 skills（而非仅开发时手动生成）
- 决策：在发布相关链路（至少 `make build`/打包入口）执行 skills 生成步骤，确保 wheel/pyinstaller 产物携带最新技能文档。
- 原因：若只在开发时手动生成，发布阶段仍可能打包旧文档。
- 备选方案：CI 仅校验不生成。被拒绝，因为本地/发布环境仍可能出现“通过校验但产物未刷新”问题。

### 6) skills 版本标识与安装前置高亮
- 决策：在生成的 skill 文档头部写入版本标识（例如 `generated_by`, `cli_version`, `generated_at`），并将 `pip3 install cz-cli  # Must be installed to use this skill` 作为固定高可见提示块。
- 原因：方便定位“文档来自哪个版本”，并降低用户漏读安装前置的概率。

### 7) install-skills 兼容策略
- 决策：`install-skills` 保持入口和用户语义不变；仅调整其读取的 skill 文件来源与校验逻辑以适配动态生成产物（必要时提供旧路径回退）。
- 原因：避免影响既有用户流程，同时消除生成机制变更带来的路径耦合风险。

## Risks / Trade-offs

- [Risk] Click introspection 对帮助文本换行/格式依赖较强，可能出现跨平台差异。
  → Mitigation: 在构建器里做换行归一化与空白压缩，并增加平台无关断言测试。

- [Risk] 长度预算裁剪后丢失部分示例细节。
  → Mitigation: 保证“核心签名与安全规则永不裁剪”，只裁剪补充示例和冗长描述。

- [Risk] 动态生成使输出在命令新增时自动变化，可能影响下游依赖。
  → Mitigation: 增加版本字段和结构化键，保证 schema 兼容；对新增字段保持可选。

- [Risk] 构建阶段生成步骤遗漏会导致发布包仍携带旧 skill。
  → Mitigation: 在打包任务中强制执行生成，并增加“生成后脏文件检查”或产物校验测试。

- [Risk] install-skills 读取路径与新生成路径不一致导致安装失败。
  → Mitigation: 增加兼容查找顺序与回归测试（本地开发路径、打包后路径、site-packages 路径）。

## Migration Plan

1. 引入命令元数据构建器并通过单测验证命令树抽取正确。
2. 改造 `cz-cli ai-guide` 使用构建器输出，保留原命令入口和总体 JSON 结构。
3. 改造 `SKILL.md` 生成流程（模板 + 动态片段），并提供生成脚本/命令。
4. 将 skills 生成接入 build/package 链路，并在产物校验中验证版本标识和前置提示可见性。
5. 增加一致性测试（help vs ai-guide vs skill）、长度预算测试和 install-skills 兼容测试。
6. 更新文档与开发说明，确保后续命令新增自动进入文档链路。

## Open Questions

- ai-guide 的默认预算上限是否应允许用户通过环境变量或参数覆盖？
- SKILL 动态生成触发时机：开发阶段手动执行，还是在 CI 中强制校验并阻断漂移？
- ai-guide 裁剪标记字段的命名是否纳入对外稳定契约？
- skills 版本标识是否需要包含 git sha（在非 git 环境如何降级）？
