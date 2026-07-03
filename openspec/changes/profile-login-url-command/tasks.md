## 1. 测试

- [x] 1.1 在 `packages/cz-cli/test/profile-login-url.test.ts` 添加未传名称时使用 `default_profile` 的测试
- [x] 1.2 在 `packages/cz-cli/test/profile-login-url.test.ts` 添加 `--tenant-name` 覆盖 profile 和远端解析的优先级测试
- [x] 1.3 在 `packages/cz-cli/test/profile-login-url.test.ts` 添加 `--resolve` 使用 PAT 解析租户名的测试
- [x] 1.4 在 `packages/cz-cli/test/profile-login-url.test.ts` 添加 `--resolve` 使用用户名密码解析租户名的测试
- [x] 1.5 在 `packages/cz-cli/test/profile-login-url.test.ts` 添加缺少租户名且未启用解析时的错误测试
- [x] 1.6 在 `packages/cz-cli/test/profile-login-url.test.ts` 添加 `service` 为 account host 时的 URL 规范化测试
- [x] 1.7 在 `packages/cz-cli/test/e2e-help/core-cases.ts` 或对应 help coverage 文件中添加 `profile login-url --help` 覆盖

## 2. CLI 实现

- [x] 2.1 在 `packages/cz-cli/src/commands/profile.ts` 注册 `profile login-url [name]` 子命令并声明 `--tenant-name`、`--resolve`、`--no-resolve`、`--open`
- [x] 2.2 在 `packages/cz-cli/src/commands/profile.ts` 读取指定 profile 或 `default_profile`，输出标准化结果字段
- [x] 2.3 在 `packages/cz-cli/src/commands/account-login.ts` 复用 `accountLoginUrlForService` 完成最终网页登录 URL 生成
- [x] 2.4 在 `packages/cz-cli/src/commands/profile.ts` 复用 SDK 当前用户接口解析 `accountDisplayName`
- [x] 2.5 在 `packages/cz-cli/src/commands/profile.ts` 为 `--open` 增加 best-effort 浏览器打开逻辑且不影响主结果

## 3. 验证

- [x] 3.1 运行 `packages/cz-cli` 中新增和相关测试
- [x] 3.2 在 `packages/cz-cli` 运行 `bun typecheck`
- [x] 3.3 运行 `openspec validate profile-login-url-command --strict`
