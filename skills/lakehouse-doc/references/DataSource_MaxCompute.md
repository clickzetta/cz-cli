# MaxCompute 数据源配置指南

## 概述

MaxCompute 是阿里云提供的一种全托管的大数据计算服务，它支持海量数据的存储、处理和分析。通过配置 MaxCompute 数据源，您可以实现与其他系统的数据同步和大数据分析。

## 参数配置

配置 MaxCompute 数据源时，需要提供以下信息以确保成功连接到服务：

* **数据源名称**：为您的 MaxCompute 数据源指定一个唯一且易于识别的名称。
* **MaxCompute 服务地址**：提供 MaxCompute 服务的 Endpoint 连接地址，这是您访问 MaxCompute 服务的主要入口，例如：`<http://service.ap-southeast-1.maxcompute.aliyun.com/api>`。
* **MaxCompute Tunnel 服务地址**（可选）：如果您使用 Tunnel 服务来提高数据传输的安全性，需要提供 Tunnel 服务的地址。例如：`http://dt.<region-name>.maxcompute.aliyun.com/api`，其中 `<region-name>` 是您的 MaxCompute 服务所在的区域名称。
* **项目空间名称**：填写与您的 MaxCompute 账户关联的项目空间名称，这是您操作和管理数据的上下文环境。
* **Access Key ID**：提供阿里云账户的 Access Key ID，用于身份验证。
* **Secret Access Key**：提供与 Access Key ID 相对应的私密访问密钥。

## 连接配置

在连接配置方面，您可以选择以下连接方式之一：

* **直连**：确保您输入的连接信息在公网可访问。如果源端开启了IP访问白名单，请确保数据集成服务的出口IP地址已被加入到白名单中，具体IP地址请联系技术支持人员。
* **通过 SSH 隧道**：为了提高安全性，您可以选择通过 SSH 隧道连接到 MaxCompute。启用此选项并提供 SSH 服务的 IP 地址和端口。确保您的 SSH 客户端已正确配置，并且您有权限通过 SSH 连接到 MaxCompute 服务器。

## 注意事项

* 确保所有提供的连接信息准确无误，并且 MaxCompute 服务是可访问的。
* 保护您的凭证信息，避免泄露给未经授权的人员。
* 定期检查并更新您的数据源配置，以适应项目空间的变化或新的安全要求。
* 监控数据同步任务的运行状态，以便及时发现并解决可能出现的问题。

完成配置后，您就可以在数据同步任务中选择此 MaxCompute 数据源，进行数据的导入或导出操作。通过 SSH 隧道或 MaxCompute Tunnel 服务连接可以增强数据传输的安全性，特别是在处理敏感数据时。
