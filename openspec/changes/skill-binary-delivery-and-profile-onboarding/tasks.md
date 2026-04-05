## 0. 前置：调整 add-command-examples-and-integration-tests 实施顺序

- [x] 0.1 编辑 `openspec/changes/add-command-examples-and-integration-tests/tasks.md`，将 Section 10-13（Integration Tests）移动到 Section 1（Examples Infrastructure）之前，重新编号为 Section 1-4，原 Section 1-9 顺延为 Section 5-13，确保集成测试先于 examples 开发实施

## 1. Skill scripts 目录结构

- [x] 1.1 在 `cz_cli/skills/cz-cli/scripts/` 下创建 `.gitkeep` 占位文件（目录本身需提交）
- [x] 1.2 在根目录 `.gitignore` 中添加规则忽略 `cz_cli/skills/cz-cli/scripts/*/`（二进制内容），保留 `.gitkeep`

## 2. build_fat_multi_platform.sh 输出到 scripts 目录

- [x] 2.1 在 `scripts/build_fat_multi_platform.sh` 的每次版本构建循环末尾，添加将二进制复制到 `cz_cli/skills/cz-cli/scripts/${TARGET_DIR_NAME}/cz-cli${BIN_EXT}` 的步骤
- [x] 2.2 确保复制步骤在 `mv -f "$SOURCE_BIN" "$TARGET_BIN"` 之后执行（从 dist 目标路径复制，而非移动），保持原有 dist 输出路径不变
- [x] 2.3 本地执行 `bash scripts/build_fat_multi_platform.sh` 验证二进制出现在 `cz_cli/skills/cz-cli/scripts/<platform>-<arch>/cz-cli`

## 3. SKILL.template.md — 更新安装说明块

- [x] 3.1 将 `SKILL.template.md` 中的原有 `> [!IMPORTANT]\n> \`pip3 install cz-cli -U  # Must be installed to use this skill\`` 块替换为：
  ```
  > [!IMPORTANT]
  > **Binary**: After skill installation, use `cz-cli` from `scripts/<platform>-<arch>/cz-cli` inside the installed skill directory.
  > **Fallback**: If binary not present, run `pip3 install cz-cli -U` then use `cz-cli` from PATH.
  ```
- [x] 3.2 确认 `SKILL.md`（generated）中对应位置已更新（通过 generate_skills.py 重新生成验证）

## 4. SKILL.template.md — 新增 Rule 0（Profile Onboarding）

- [x] 4.1 在 `SKILL.template.md` 的 `## AI Agent Behavior Rules` 中，`### Rule 1` 之前插入 Rule 0 完整内容：

  ```markdown
  ### Rule 0 — Initialize connection profile before first use

  Before executing any command that requires a Lakehouse connection, run `cz-cli profile list`.

  **If the result is an empty list** (no profiles configured):
  1. **MUST** use the **AskUserQuestion tool** (not plain text) to ask the user to choose authentication method: PAT (recommended) or username/password.
  2. Collect required fields step by step via AskUserQuestion: instance ID, workspace name, and optionally schema and vcluster.
  3. Call `cz-cli profile create <name> [--pat VALUE | --username VALUE --password VALUE] --instance VALUE --workspace VALUE`.
  4. Verify success (exit_code=0, ok=true), then proceed with the original request.

  **MUST NOT** ask the user to configure the profile themselves in a chat message — the Agent must drive the entire onboarding interactively.

  **If profile list fails with a network/connection error** (not an empty list): report the error and ask the user to check connectivity. Do NOT enter onboarding flow.
  ```

- [x] 4.2 重新生成 `SKILL.md` 并验证 Rule 0 出现在 Rule 1 之前

## 5. skills_installer.py 兼容性验证

- [x] 5.1 确认 `shutil.copytree` 在安装 cz-cli skill 时会自动包含 `scripts/` 子目录（无需代码修改，只需验证）
- [x] 5.2 如果 `scripts/` 目录为空（只有 `.gitkeep`），验证安装不报错

## 6. 重新生成 SKILL.md 并验证

- [x] 6.1 运行 `python scripts/generate_skills.py` 重新生成 `cz_cli/skills/cz-cli/SKILL.md`
- [x] 6.2 运行 `python scripts/generate_skills.py --check` 确认零 drift
- [x] 6.3 人工检查生成的 `SKILL.md`：确认顶部无 pip 必装提示 → 有 binary/fallback 说明；Rule 0 存在且在 Rule 1 之前

## 7. Lint 和测试

- [x] 7.1 运行 `make lint` 确认无 ruff 违规
- [x] 7.2 运行 `make test` 确认所有单元测试通过

## 8. CHANGELOG

- [x] 8.1 在 `CHANGELOG.md` 中添加条目：`skill: bundle platform binary in scripts/; replace pip install requirement with binary-first instruction; add Rule 0 for profile onboarding via interactive clarification`
