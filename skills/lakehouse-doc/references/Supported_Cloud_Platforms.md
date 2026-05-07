# 云服务和地域支持

## 地域支持

云器 Lakehouse 作为一款 SaaS 化的数据管理与分析服务，充分利用云上基础设施，为用户提供高效、便捷的服务体验。我们致力于满足客户与业务系统在不同云服务商及地域的数据打通与集成需求。

目前，云器 Lakehouse 已在以下云服务商及地域提供服务，并计划扩展更多：

| 云服务商 | 地域       | 区域代码                      |
| ---- | -------- | ------------------------- |
| 阿里云  | 华东2（上海）  | cn-shanghai-alicloud      |
| 腾讯云  | 华东地区（上海） | ap-shanghai-tencentcloud  |
| 腾讯云  | 华北地区（北京） | ap-beijing-tencentcloud   |
| 腾讯云  | 华南地区（广州） | ap-guangzhou-tencentcloud |
| 亚马逊云 | 北京       | cn-north-1-aws            |

## 服务域名

当您注册云器 Lakehouse 账户后，系统会自动分配一个唯一的账户名称。在进行账户管理时，您需要使用该账户名称登录账户中心。在账户中心，管理员可以为您在指定的云服务商及区域开通并创建 Lakehouse 服务实例。请注意，Lakehouse 服务实例名称是全局唯一的。

| 服务                           | 子服务             | 域名                                                                           |
| ---------------------------- | --------------- | ---------------------------------------------------------------------------- |
| 账户控制台                        | 账户管理中心          | accounts.app.clickzetta.com&#xA;\<account\_name>.accounts.app.clickzetta.com |
| 账户控制台                        | 账户管理中心          | accounts.clickzetta.com&#xA;\<account\_name>.accounts.clickzetta.com         |
| 产品Web控制台                     | Lakehouse实例控制台  | \<instance\_name>.app.clickzetta.com                                         |
|                              | Lakehouse工作空间列表 | \<instance\_name>.app.lakehouse.clickzetta.com/workspace                     |
| Lakehouse JDBC URL           |                 | jdbc\:clickzetta://\<instance\_name>.\<region\_id>.api.clickzetta.com/       |
| Lakehouse Streaming API Host |                 | \<instance\_name>.streamingapi.clickzetta.com                                |

JDBC域名&服务地址(Endpoint)详细列表

| 云服务商 | 地域       | region\_id(区域代码)          | JDBC域名                                                                             | Endpoint                                     |
| ---- | -------- | ------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| 阿里云  | 华东2（上海）  | cn-shanghai-alicloud      | jdbc\:clickzetta://\<instance\_name>.cn-shanghai-alicloud.api.clickzetta.com/      | cn-shanghai-alicloud.api.clickzetta.com      |
| 腾讯云  | 华东地区（上海） | ap-shanghai-tencentcloud  | jdbc\:clickzetta://\<instance\_name>.ap-southeast-1-alicloud.api.clickzetta.com/   | ap-shanghai-tencentcloud.api.clickzetta.com  |
| 腾讯云  | 华北地区（北京） | ap-beijing-tencentcloud   | jdbc\:clickzetta://\<instance\_name>.ap-beijing-tencentcloud.api.clickzetta.com/   | ap-beijing-tencentcloud.api.clickzetta.com   |
| 腾讯云  | 华南地区（广州） | ap-guangzhou-tencentcloud | jdbc\:clickzetta://\<instance\_name>.ap-guangzhou-tencentcloud.api.clickzetta.com/ | ap-guangzhou-tencentcloud.api.clickzetta.com |
| 亚马逊云 | 北京       | cn-north-1-aws            | jdbc\:clickzetta://\<instance\_name>.cn-north-1-aws.api.clickzetta.com/            | cn-north-1-aws.api.clickzetta.com            |

说明：账户名称\<account\_name>和实例名称\<instance\_name>的创建和获取，请参考[开通使用](LoggingIn.md)。
