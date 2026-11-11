# Git 推送

分支、提交和 PR 的命名规则见 [AGENTS](../../AGENTS.md#branch-names)。

已授权的 Git 推送使用无代理连接，尤其是 Gerrit：优先使用当前 shell 的 `noproxy`；没有该命令时，仅对本次推送清除代理环境变量，设置 `NO_PROXY=*`、`no_proxy=*`，SSH 显式设置 `ProxyCommand=none`、`ProxyJump=none`。不永久修改用户代理配置。

推送被 pre-push 钩子挡住时，先看[工程坑](pitfalls.md)。
