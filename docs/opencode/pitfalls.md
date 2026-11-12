# opencode 容易踩的坑

每条按「什么时候会踩 → 结论和条件 → 证据 → 下次怎么做」写。改上游包、换基线或改注入前先读一遍；发现新坑或某条已失效，按[记忆协议](../maintenance/memory-workflow.md)记录。

## 换基线

- **侵入式补丁会被悄悄覆盖**：升级 opencode 基线、解决完冲突后，能合并、能编译不代表补丁还在。1.17.11 换基线时就丢过（账本条目 1）。没有标记的条目（账本 #12）和台账外的改动连 grep 都查不到。下次逐条跑账本里的验证步骤，再用 `git diff <旧 tag> HEAD --name-only -- packages/{core,opencode,tui,schema,plugin}` 对一遍账本。证据：[补丁账本](../../packages/cz-cli/UPSTREAM-PATCHES.md)。
- **有一处上游改动不在账本里**：[#121](https://github.com/clickzetta/cz-cli/pull/121) 给 `packages/plugin` 加了 `experimental.chat.llm` hook，并改了 `opencode/src/session/llm.ts` 等文件，既没有标记也没有登记。下次换基线前先给它补账本条目；账本的扫描范围也要加上 `packages/plugin`。
- **上游 tag 不是线性的**：`v1.17.12`、`v1.18.0`、`v1.18.9` 都不包含 `v1.17.11`，版本号更大不代表是超集。挑新基线或判断「新版本有没有某个修复」时，用 `git merge-base --is-ancestor` 或直接查提交，不要按版本号推断。

## 注入与插件

- **项目级配置默认是关的**：用户在仓库里放了 `.opencode/`、`opencode.json` 或项目 AGENTS.md，却发现 cz-cli 不认，原因是 cz-cli 默认设了 `OPENCODE_DISABLE_PROJECT_CONFIG=1`，项目级配置和指令发现一起被跳过；显式设 `=0` 才恢复。先查这个变量，不要先怀疑加载器。证据：`bootstrap/upstream-autoupdate.ts`、`opencode/src/session/instruction.ts`。
- **插件只看得到 v1 消息事件**：写插件或 OTel 时订阅不到 `session.next.*` 的 step 和 tool 事件，唯一例外是 `session.next.model.switched`；assistant 消息的模型字段是平铺的 `modelID`，读嵌套的 `info.model` 拿不到值。用 `Event["type"]` 作订阅类型，让编译器拦住不存在的事件名。证据：`opencode-plugin/otel/handlers.ts`。
- **只在 TUI 里验证注入会被骗**：TUI 的 server 跑在 Worker 里，会重新加载模块，所以「import 时就读取 flag」的问题在 TUI 下看不出来，`run`、`serve`、`agent llm` 却会坏。注入相关的改动至少再用 `agent run` 或 `agent llm models` 验证一次。证据：账本 #5、`opencode-injection.ts` 文件头注释。
- **开发入口和编译产物注入不一致**：`bun run src/main.ts` 不加载 `env-shim`，普通命令也拿不到基础层，现象可能和二进制不同。涉及注入的问题用构建出的二进制复现。见[扩展点](extension-points.md#各入口拿到了什么)。
- **改 bash 等上游工具前先找 hook**：能用 `shell.env` 等插件 hook 在 cz 层实现的，就不要改 `packages/core`；实在要改，加标记并登记账本，否则下次换基线会被覆盖。
