# 腾讯云

当需要使用云器 Lakehouse 访问你在云厂商 VPC 内的服务（如自建的 MySQL 数据库）时，你首先需要在腾讯云创建终端节点服务，并将需要被访问的服务配置为该终端节点服务的服务资源。

:-: ![](.topwrite/assets/private_link访问客户-例子.png)

## 操作步骤

1\. 在腾讯云的网络连接-终端节点服务页面，选择与当前Lakehouse服务实例相同的地域创建终端节点服务。您可以在Lakehouse服务“创建终端节点服务”的弹窗上方找到当前服务实例所在的地域和可用区。请按照当前服务实例的地域和可用区创建终端节点服务，否则会导致Lakehouse无法创建对应的终端节点而无法建立PrivateLink。

:-: ![](.topwrite/assets/image.png =412)

2\. 完成终端节点服务创建后，点击终端节点服务名称，进入详情页。切换到“白名单”页签，点击“添加”按钮，添加Lakehouse服务的UIN。您可在Lakehouse服务新建终端节点服务的信息弹窗中复制“Lakehouse UID”填入。

:-: ![](.topwrite/assets/image.png =412)

3\. 完成后，请复制您的终端节点服务ID，并粘贴在Lakehouse的创建页面中，点击“确定”即完成终端节点服务的创建。

:-: ![](.topwrite/assets/image_1733063879303.png =408)
