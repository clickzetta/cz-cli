## Why

用户已经可以通过 profile 保存 `service`、`instance`、`workspace` 和认证信息，但当需要跳转到网页登录页时，仍然要手工推导租户名和账号站点 URL。这个过程容易出错，尤其是在 `api`、`app`、`accounts` 多种域名形态并存时。

当前仓库已经具备两块关键能力：

- 可以根据 service/account host 推导账号站点 URL；
- 可以通过现有认证信息获取当前用户信息，其中包含 `accountDisplayName`。

因此 CLI 应该直接提供一个“获取网页登录 URL”的命令，避免用户手工拼接域名。

## What Changes

- 新增 `cz-cli profile login-url [name]` 子命令，用于返回指定 profile 的网页登录 URL。
- 命令在未传 profile 名称时默认读取 `default_profile`。
- 命令支持 `--tenant-name` 显式指定租户名，避免远端解析。
- 命令支持 `--resolve` / `--no-resolve` 控制是否通过现有认证信息远端解析租户名。
- 命令支持 `--open` best-effort 打开系统浏览器，同时始终打印 URL。
- 命令输出包含 `profile`、`tenant_name`、`tenant_name_source`、`service`、`web_login_url` 等用户可直接消费的字段。

## Capabilities

### New Capabilities
- `profile-login-url`: 从 profile 生成或解析 ClickZetta/Singdata 账号登录 URL，覆盖租户名来源优先级、URL 规范化、浏览器打开和错误场景。

### Modified Capabilities
- `cli-command-routing`: `profile login-url` 应被 `profile` 命令 help 识别并暴露。
- `help-coverage`: `profile login-url` 命令 help 应被覆盖，并且 help 渲染不依赖 profile 或远端 API。

## Impact

- `packages/cz-cli/src/commands/profile.ts`: 注册 `profile login-url [name]` 子命令。
- `packages/cz-cli/src/commands/account-login.ts`: 复用或提炼账号登录 URL 推导 helper。
- `packages/cz-cli/test/profile-login-url.test.ts`: 增加租户名优先级、URL 生成和错误场景测试。
- `packages/cz-cli/test/e2e-help.ts` 或对应 help coverage 文件：增加 `profile login-url --help` 覆盖。
- 认证路径：复用 `@clickzetta/sdk` 的 token/user 查询能力，不新增新的远端协议。
