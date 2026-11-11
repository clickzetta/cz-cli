# 上游补丁

ClickZetta 行为优先放在 `packages/cz-cli`，通过插件、hook、环境变量或配置接入上游。包边界、例外和现有改动以[补丁账本](../../packages/cz-cli/UPSTREAM-PATCHES.md)为准。

涉及上游包时先检查账本；新增侵入式改动同步维护源码标记、原因和验证入口。更新上游基线时，按[重验流程](../../packages/cz-cli/UPSTREAM-PATCHES.md#re-baseline-procedure-quick)逐项核对，不能只确认合并或编译成功。

容易踩的坑见 [opencode 坑](pitfalls.md)，各注入入口见[扩展点](extension-points.md)。
