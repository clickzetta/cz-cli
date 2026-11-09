# 上游定制

ClickZetta 行为优先放在 `packages/cz-cli`，通过插件、hook、环境变量或配置接入上游。包边界、例外和现有改动以[补丁账本](../../packages/cz-cli/UPSTREAM-PATCHES.md)为准。

涉及上游包时先检查账本；新增侵入式改动同步维护源码标记、原因和验证入口。更新上游基线时，按[重验流程](../../packages/cz-cli/UPSTREAM-PATCHES.md#re-baseline-procedure-quick)逐项核对，不能只确认合并或编译成功。

已授权的 Git 推送使用无代理连接，尤其是 Gerrit：优先使用当前 shell 的 `noproxy`；没有该命令时，仅对本次推送清除代理环境变量，设置 `NO_PROXY=*`、`no_proxy=*`，SSH 显式设置 `ProxyCommand=none`、`ProxyJump=none`。不永久修改用户代理配置。
