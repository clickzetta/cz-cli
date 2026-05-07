# 创建腾讯云私网连接终端节点

当您需要在云厂商 VPC 内通过内网访问云器 Lakehouse 服务时，您需要在腾讯云创建连接云器 Lakehouse 终端节点服务的终端节点。然后，将访问云器 Lakehouse 的 JDBC 连接或 API 的域名替换为终端节点的域名。

:-: ![](.topwrite/assets/privatelink客户访问LH-例子.png)

## 操作步骤

1\. **添加白名单**。首先请将您的云平台账号（角色）添加至云器Lakehouse 私有网络连接的白名单中。如下图所示：

:-: ![](.topwrite/assets/image_1732869126126.png =704)

为保障 Lakehouse 能够正常读取您的终端节点状态，并增强从您云服务平台获取终端节点信息方式的安全性，请在云服务平台内创建独立的访问控制角色，并授权及添加 External ID。

**查询 ARN 和 External ID**：

在腾讯云访问控制角色列表页面，单击希望添加其 ARN 的角色名称，在角色详情中选择“角色载体”，分别复制该页面中的“**RoleArn**”和“**外部ID**”。回到云器 Lakehouse 页面，在添加白名单弹窗中，分别将上述两项内容复制到对应的输入框中。粘贴完成后，单击“确定”。

该角色的权限配置和 External ID 配置详见 [获取腾讯云ARN和ExternalID](tencentcloud_arn_and_externalid.md)。

:-: ![](.topwrite/assets/image_1733067670318.png =699)

:-: ![](.topwrite/assets/image_1733067744128.png =703)

^

:-: ![](.topwrite/assets/image_1733067854956.png =377)

2\. **新建终端节点**。在终端节点页面点击“新建”按钮，“对端账户类型”选择“其他账户”。然后，在“对端账户 UIN”和“对端终端节点服务 ID”中，分别填入从 Lakehouse 页面复制的“Lakehouse UID”和“终端节点服务 ID”。点击“确定”。

:-: ![](.topwrite/assets/image_1733063999441.png =378)

3\. **允许终端节点连接**。创建完成后，刷新![](.topwrite/assets/image_1733110508458.png =27)Lakehouse中“终端节点”页面，即可在列表中看到您已创建的终端节点，点击“允许连接”即可完成基于私有连接的网络互通配置。
