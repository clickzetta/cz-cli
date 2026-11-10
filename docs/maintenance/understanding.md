# 易误解的设计与产品点

只记录已经导致错误判断、且有代码、测试、公开讨论或人工决定支撑的边界；每条包含“常见误解 → 实际约束 → 依据”。相关任务开始前按需读取。

## 安装脚本的地址与版本参数

README 中的示例也可能与实际发布链路不一致。核对脚本的真实下载地址、返回内容及参数解析，不能仅凭文档假定存在 GitHub release asset，或假定脚本读取某个环境变量。

依据：[Issue #148](https://github.com/clickzetta/cz-cli/issues/148)、[修复 PR #150](https://github.com/clickzetta/cz-cli/pull/150)。后续安装改动同时验证默认安装与指定版本示例。
