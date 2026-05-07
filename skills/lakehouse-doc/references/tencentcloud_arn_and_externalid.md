# 获取腾讯云ARN和ExternalID

在配置 Private Link 访问 Lakehouse 网络时，为保障 Lakehouse 能够正常读取您云平台账号内的终端节点状态，并增强该获取方式的安全性，请在云服务平台内创建独立的访问控制角色，并授权及添加 External ID。具体操作如下：

^

## 腾讯云

**获取 ARN 方式**：

您需要在腾讯云访问控制页面（<https://console.cloud.tencent.com/cam/role>）点击“新建角色”，并选择角色载体为“腾讯云账户”：

:-: ![](.topwrite/assets/image_1733066596983.png =383)

“云账号类型”选择“其他主账号”；

在“账号ID”内填入 Lakehouse 页面上显示的 UID；

在“外部ID”选项中勾选“开启校验”，并自定义一串字符用于后续校验。

:-: ![](.topwrite/assets/image_1733066790847.png =660)

在“配置角色策略”中找到“私有网络（VPC）只读访问权限”策略并勾选（Lakehouse 需要通过该角色调用 DescribeVpcEndpoint 和 DescribeVpcEndpointService 接口）；

:-: ![](.topwrite/assets/image_1733067463964.png =665)

定义角色名称，并点击“完成”按钮，完成角色创建。

:-: ![](.topwrite/assets/image_1733067522805.png =675)
