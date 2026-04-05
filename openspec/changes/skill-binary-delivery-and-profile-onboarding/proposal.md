## Why

三个紧密相关的问题需要在同一个 change 中解决：

1. **集成测试先于 examples**：examples 字符串如果基于未经真实环境验证的命令用法编写，可能本身就是错的。集成测试必须先完成，才能保证 examples 的正确性。需要调整 `add-command-examples-and-integration-tests` 的实施顺序：先完成集成测试（tasks 10-13），再开发 examples（tasks 1-9）。

2. **Skill 二进制交付**：当前 SKILL.md 要求用户 `pip3 install cz-cli`，这在 Claude Desktop 等沙盒环境中并不总是可行。`build_fat_multi_platform.sh` 已经能构建独立的 PyInstaller 二进制，但输出放在 `dist/` 而非 skill 包内。需要将二进制输出到 `cz_cli/skills/cz-cli/scripts/` 目录，skill 通过该脚本直接调用，彻底消除对 pip 的依赖，并更新 `SKILL.template.md` 去掉 pip 安装提醒。

3. **Profile 初始化人机交互**：AI Agent（如 Claude Desktop）在收到用户的第一个请求时，如果没有 profile 配置，当前的 SKILL.md 没有指导 Agent 通过人机交互方式引导用户完成 profile 配置。Agent 无法替用户直接完成 profile 初始化（需要密码、instance 等敏感信息），必须通过 AskUserQuestion 澄清，并用收集到的信息调用 `cz-cli profile create`。

## What Changes

- **调整 tasks 顺序**：更新 `add-command-examples-and-integration-tests/tasks.md`，将集成测试（tasks 10-13）移到 examples 开发（tasks 1-9）之前执行。
- **build_fat_multi_platform.sh 输出路径**：增加一步，将构建出的二进制同时复制到 `cz_cli/skills/cz-cli/scripts/<platform>-<arch>/cz-cli[.exe]`。
- **SKILL.template.md**：删除 `pip3 install cz-cli` 提示，替换为说明 skill 内置脚本路径的使用方式（`scripts/<platform>/cz-cli`）。
- **skills_installer.py**：安装时一并复制 `scripts/` 子目录（二进制文件）到目标 skill 目录。
- **SKILL.template.md — Rule 0（新增）**：在 AI Agent Behavior Rules 最前面新增 Rule 0：当用户首次请求且没有配置 profile 时，Agent **必须**通过 AskUserQuestion 工具逐步收集连接信息（username/password/pat、instance、workspace 等），然后调用 `cz-cli profile create` 完成初始化，而非直接尝试执行命令或告知用户自行配置。

## Capabilities

### New Capabilities

- `skill-binary-scripts`: 构建产物将二进制放入 skill 的 `scripts/` 目录，skill 无需 pip 即可运行。
- `profile-onboarding-rule`: SKILL 中新增 Rule 0，指导 Agent 在无 profile 时通过人机交互完成初始化。

### Modified Capabilities

- `skill-document-generation`: SKILL.template.md 去掉 pip 安装提醒，改为 scripts 使用说明。
- `add-command-examples-and-integration-tests`（外部 change 的 tasks 顺序）：集成测试先于 examples 实施。

## Impact

- `scripts/build_fat_multi_platform.sh`：增加 copy step 到 `cz_cli/skills/cz-cli/scripts/`
- `cz_cli/SKILL.template.md`：更新顶部安装说明块和新增 Rule 0
- `cz_cli/skills/cz-cli/SKILL.md`：重新生成
- `cz_cli/commands/skills_installer.py`：安装时包含 `scripts/` 子目录
- `openspec/changes/add-command-examples-and-integration-tests/tasks.md`：调整 section 顺序
- 新增目录 `cz_cli/skills/cz-cli/scripts/`（gitignore 二进制，但保留目录结构占位）
