# 创建阿里云私网连接终端节点

当您需要在云厂商 VPC 内通过内网访问云器 Lakehouse 服务时，您需要在阿里云创建连接云器 Lakehouse 终端节点服务的终端节点。然后，将访问云器 Lakehouse 的 JDBC 连接或 API 的域名替换为终端节点的域名。

:-: ![](.topwrite/assets/privatelink客户访问LH-例子.png)

## 操作步骤

1\. **添加白名单**。首先请将您的云平台账号（角色）添加至云器 Lakehouse 私有网络连接的白名单中。如下图所示：

:-: ![](.topwrite/assets/image_1733063925523.png =708)

为保障 Lakehouse 能够正常读取您的终端节点状态，并增强获取您云服务平台内终端节点信息的安全性，请在云服务平台内创建独立的访问控制角色，并授权及添加 External ID。

**ARN 和 External ID 值获取**：

在阿里云“RAM 访问控制” > “角色”页面，选择希望添加其 ARN 的访问控制角色，分别复制其 ARN 和 External ID 的值。然后，回到云器 Lakehouse 页面，在添加白名单弹窗中，分别将上述两项内容复制到对应的选项中。&#x20;

该角色的权限配置和 External ID 配置详见[获取阿里云ARN和ExternalID](alicloud-arn-externalid.md)。

:-: ![](.topwrite/assets/image_1733069144028.png =684)

^

:-: ![](.topwrite/assets/image_1733069236299.png =366)

2\. **创建终端节点**。在阿里云控制台的“终端节点”页面中，点击“新建终端节点”按钮。在“所属地域”中选择与 Lakehouse 服务相同的地域，并在页面中选择“其他终端节点服务”，从 Lakehouse 服务中复制该区域的终端节点服务名称，填入此页面。

:-: ![](.topwrite/assets/image_1733063937656.png =683)

^

:-: ![](.topwrite/assets/image_1733063950478.png =677)

3\. **允许终端节点连接**。创建完成后，刷新 Lakehouse 中的“终端节点”页面，即可在列表中看到您已创建的终端节点，点击“允许连接”即可完成基于私网连接的网络互通配置。

^
