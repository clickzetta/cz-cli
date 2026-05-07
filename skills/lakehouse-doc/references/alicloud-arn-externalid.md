# 获取ARN和ExternalID

在配置 Private Link 访问 Lakehouse 网络时，为保障 Lakehouse 能够正常读取您云平台账号内的终端节点状态，并增强该获取方式的安全性，请在云服务平台内创建独立的访问控制角色，并授权及添加 External ID。具体操作如下。

## 阿里云

**获取 ARN 方式**：

首先，需要在阿里云访问控制页面（<https://ram.console.aliyun.com/roles>）点击“新建角色”，并选择可行实体类型为：阿里云账号：

:-: ![](.topwrite/assets/image_1733068362672.png =424)

^

在角色名称中填入自定义角色名称；

在“选择信任的云账号”中选择“其他云账号”，并复制 Lakehouse 终端节点服务的 LakehouseUID 内容填入。

:-: ![](.topwrite/assets/image_1733068490413.png =648)

^

角色创建完成后，点击“为角色授权”，并点击“新建授权”；

:-: ![](.topwrite/assets/image_1733068711869.png =673)

^

搜索“privatelink”，并勾选 AliyunPrivateLinkReadOnlyAccess 和 AliyunPrivateLinkEndpointServiceReadOnlyAccess 两个策略；

:-: ![](.topwrite/assets/image_1733068776650.png =687)

^

完成“确认新增授权”后，切换到“信任策略”页签，并点击“编辑信任策略”：

:-: ![](.topwrite/assets/image_1733068938505.png =685)

在 "Action": "sts:AssumeRole" 和 "Effect": "Allow" 之间粘贴以下内容：

```
"Condition": {
        "StringEquals": {
          "sts:ExternalId": "请替换成自定义的externalID"
        }
      },
```

粘贴完成后，保存信任策略。

^
