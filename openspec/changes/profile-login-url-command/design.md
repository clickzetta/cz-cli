## Context

当前 CLI 已经有两条相关路径：

1. `profile` 命令族负责管理连接配置；
2. `account-login.ts` 已包含从 `service` 或 account host 推导账号站点 URL 的逻辑。

另一方面，租户名并不总是保存在 profile 中。实际生成网页登录 URL 时，CLI 需要先决定租户名来源，再调用统一 URL 生成逻辑输出账号站点 URL。

## Goals / Non-Goals

**Goals**

- 让用户可以通过单个命令直接拿到网页登录 URL。
- 优先复用已有 helper 和现有认证路径，不引入新的站点协议。
- 支持脚本化使用，输出结构化字段而不仅仅是一行字符串。
- 支持 best-effort 打开浏览器，但浏览器失败不影响 URL 获取。

**Non-Goals**

- 本变更不实现真正的网页登录、扫码登录或浏览器自动注入 session。
- 本变更不修改 `setup` 的主流程，也不要求首次引导必须调用该命令。
- 本变更第一阶段不强制把租户名持久化回 `profiles.toml`。

## Decisions

### 1. 命令挂在 `profile` 下，而不是 `setup`

- 命令的输入核心是 profile；
- 用户日常切换不同连接时，更自然地在 `profile` 语义下查找；
- `setup` 更偏首次引导，不适合作为通用跳转工具入口。

最终命令面：

- `cz-cli profile login-url`
- `cz-cli profile login-url <name>`

### 2. 租户名按显式参数优先，其次本地缓存，最后按需远端解析

租户名来源优先级：

1. `--tenant-name`
2. profile 中已保存的 `tenant_name` 或 `account_display_name`
3. `--resolve` 时通过现有认证能力远端获取

这样可以兼顾三类场景：

- 已知租户名：完全本地，无需发请求；
- profile 已缓存：快速返回；
- 只有 PAT 或用户名密码：允许远端补齐。

### 3. 默认不隐式远端解析

`login-url` 虽然是轻量命令，但远端解析需要认证并访问 API。默认不隐式解析可以避免：

- 用户误以为命令是纯本地的；
- help 之外的轻量脚本触发不必要网络访问；
- 用户在过期 PAT/密码场景下拿 URL 时被意外阻塞。

因此：

- `--resolve`：允许远端解析租户名
- `--no-resolve`：显式禁止远端解析（即使未来默认行为调整，也保持可控）

### 4. `--open` 采用 best-effort 语义

`--open` 只负责尝试调用系统浏览器：

- 成功时仍然输出 URL；
- 失败时不应改变命令主结果，只附带打开失败提示。

这与现有 `setup` 规格中“浏览器打开失败不应中断主流程”的原则保持一致。

### 5. 输出以结构化字段为主

主要输出字段：

- `profile`
- `service`
- `instance`
- `tenant_name`
- `tenant_name_source`
- `web_login_url`
- `opened`

其中 `tenant_name_source` 的候选值：

- `arg`
- `profile`
- `resolved_pat`
- `resolved_password`

### 6. 第一阶段不写回 profile

虽然远端解析出的租户名可以缓存回 `profiles.toml`，但这会引入额外的本地状态写入语义：

- 需要明确字段名与兼容策略；
- 需要处理 `profile create/update` 的展示和脱敏行为；
- 需要额外测试配置写回。

因此第一阶段先只返回结果，不持久化。

## Risks / Trade-offs

- 默认不远端解析会让首次使用需要多传 `--resolve`，但换来更可预测的本地/远端边界。
- 不持久化租户名会导致重复解析，但避免把轻量查询命令变成隐式配置修改。
- 若 service 已是 account 域名且未带租户前缀，仍然需要租户名才能得到最终登录 URL；命令必须明确报错而不是猜测。

## Command Sketch

```bash
cz-cli profile login-url [name]
  [--tenant-name <name>]
  [--resolve | --no-resolve]
  [--open]
```

返回示例：

```json
{
  "profile": "default",
  "service": "https://cn-shanghai-alicloud.api.clickzetta.com",
  "instance": "1222f1ad",
  "tenant_name": "vmhmdkcc",
  "tenant_name_source": "resolved_pat",
  "web_login_url": "https://vmhmdkcc.cn-shanghai-alicloud-accounts.clickzetta.com",
  "opened": false
}
```

## Future Follow-up

- 可选地增加 `profile update --tenant-name` 或自动缓存租户名。
- 可选增加纯文本输出快捷模式，例如 `--field web_login_url` 供脚本直接消费。
