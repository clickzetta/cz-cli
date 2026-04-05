## Context

**当前状态**：
- `build_fat_multi_platform.sh` 将 PyInstaller 二进制输出到 `dist/<version>/<platform>-<arch>/cz-cli`，不进入 skill 包。
- `SKILL.template.md` 顶部有 `pip3 install cz-cli -U` 强提示，Claude Desktop 等沙盒环境中该命令可能不可执行。
- `SKILL.md` 的 AI Agent Behavior Rules 从 Rule 1 开始，没有覆盖"无 profile 时首次连接"这个前置场景。
- `add-command-examples-and-integration-tests` 的 tasks.md 将 integration tests 放在 examples 之后，存在"先写例子再测试"的风险。

**约束**：
- 二进制是平台相关的（macos-arm64、linux-x86_64 等），不能跨平台使用，不能单纯地 `git add` 进仓库。
- `install-skills` 是交互式安装器，安装时从 package 目录复制 skill 到目标工具。
- SKILL.md 是从 SKILL.template.md + 动态生成的 command inventory 合成的，直接修改 SKILL.md 会被 generate_skills.py 覆盖。

## Goals / Non-Goals

**Goals:**
- 构建脚本将当前平台的二进制额外复制到 `cz_cli/skills/cz-cli/scripts/<platform>-<arch>/cz-cli`，skill 安装后可直接使用内置二进制，无需 pip。
- SKILL.template.md 去掉 pip 安装提示，改为 scripts 路径说明；新增 Rule 0 描述无 profile 时的人机交互流程。
- `skills_installer.py` 安装 skill 时将 `scripts/` 子目录一并复制（含二进制）。
- `add-command-examples-and-integration-tests/tasks.md` 重排序：集成测试 sections 提前到 examples sections 之前。

**Non-Goals:**
- 跨平台二进制分发（只打包当前 build 平台）。
- 自动化 profile 创建（Rule 0 指导 Agent 使用 AskUserQuestion 收集信息，最终仍由 Agent 调用 `cz-cli profile create`）。
- 修改 `profile create` 命令本身（只改 SKILL）。

## Decisions

### D1: scripts 目录结构与 gitignore

**Decision**: 目录结构为 `cz_cli/skills/cz-cli/scripts/<platform>-<arch>/cz-cli[.exe]`，与构建脚本的 `TARGET_DIR_NAME` 变量保持一致（`${PLATFORM_TAG}-${ARCH_TAG}`）。在 `.gitignore` 中忽略 `cz_cli/skills/cz-cli/scripts/*/`（二进制），但保留 `cz_cli/skills/cz-cli/scripts/.gitkeep` 占位。`install-skills` 安装时如果 `scripts/` 存在则一并复制，不存在则跳过（降级为提示 pip）。

**Alternatives considered**:
- 放在 `dist/` 并让 skills_installer 引用：安装路径复杂，与当前 `shutil.copytree` 模式不兼容。
- 构建时直接打包进 wheel：会导致 wheel 体积极大（>50MB），PyPI 不接受。

### D2: SKILL.template.md pip 替换方案

**Decision**: 将原有的 `> [!IMPORTANT] pip3 install cz-cli -U` block 替换为：
```
> [!IMPORTANT]
> **Binary**: use `cz-cli` from skill `scripts/<platform>-<arch>/` directory (installed with skill).
> **Fallback**: if binary not present, run `pip3 install cz-cli -U` then use `cz-cli` from PATH.
```
这样在没有打包二进制的开发环境中仍然可用（fallback）。

### D3: Rule 0 — Profile onboarding 的触发条件与流程

**Decision**: Rule 0 放在所有其他 Rules 之前，触发条件为：执行任何需要连接的命令前，先调用 `cz-cli profile list`，如果返回空列表或错误，则判定为"无 profile"，进入人机交互流程。

流程：
1. AskUserQuestion 收集：认证方式（PAT 还是用户名/密码）
2. AskUserQuestion 收集：instance ID、workspace、schema（可选）、vcluster（可选）
3. 调用 `cz-cli profile create <name> [--pat|--username --password] --instance ... --workspace ...`
4. 验证成功后继续原始任务

**Rule 0 文本重点**：
- 明确"MUST use AskUserQuestion tool, NOT plain text prompts"
- 明确不应一次性抛出所有字段让用户填写（体验差），而是分步澄清
- 明确 PAT 优先于用户名/密码

### D4: tasks 顺序调整策略

**Decision**: 直接编辑 `add-command-examples-and-integration-tests/tasks.md`，将 Section 10-13（Integration Tests）移动到 Section 1（Examples Infrastructure）之前，成为新的 Section 1-4，原 Section 1-9 顺延为 Section 5-13。新增 Section 0 说明实施顺序理由。

## Risks / Trade-offs

- **scripts/ 二进制缺失时 skill 降级** → 在 SKILL 中写明 fallback，Agent 自行判断。
- **Rule 0 过度触发**（profile 存在但 `profile list` 因网络问题失败）→ Rule 0 明确只在"profile list 返回空列表"时触发，网络错误应上报而非进入 onboarding。
- **scripts/ 目录随 git 提交了旧二进制** → `.gitignore` 覆盖 `scripts/*/`，只保留 `.gitkeep`。

## Open Questions

- 无阻塞项。scripts 目录的平台覆盖（是否需要在 CI 中多平台构建并 commit）由后续 CI 任务处理，本 change 只定义本地构建时的行为。
