# AMQP 数据源配置指南

## 概述

AMQP（Advanced Message Queuing Protocol）是一种异步消息传输协议，以其高可靠性和灵活性广泛应用于物联网(IoT)、微服务架构和企业系统集成中。通过配置AMQP数据源，您可以实现与阿里云物联网平台等系统的高效数据交换。

## 参数配置

配置 AMQP 数据源时，需要提供以下信息以确保成功连接到 AMQP 服务：

* 数据源名称：为您的 AMQP 数据源指定一个唯一且易于识别的名称。
* Host：提供AMQP服务的接入域名，通常格式为 `${uid}.iot-amqp.${YourRegionId}.aliyuncs.com`。详情请参见[阿里云管理实例终端节点](https://help.aliyun.com/zh/iot/user-guide/manage-the-endpoint-of-an-instance#task-1545804)
* 认证方式：目前支持通过RAM账号认证和基于RAM账号的角色扮演认证。请选择配置合适的认证方式。
* IOT INSTANCE ID：IOT实例ID。您可在[阿里云物联网平台控制台](https://iot.console.aliyun.com/)的实例概览页面，查看当前实例的ID。
* 数据源描述：（可选）为数据源添加描述性信息，以帮助您或其他管理员理解该数据源的用途或特点。

## 认证方式配置

选择适合您的认证方式，并根据实际情况配置以下参数：

* 通过RAM账号连接：此种模式直接使用RAM账号进行连接，需要配置如下参数：
  * AccessKey ID：阿里云主账号或对应RAM用户的AccessKey ID和AccessKey Secret。登录阿里云物联网平台控制台，将鼠标移至账号头像上，然后单击AccessKey管理，获取AccessKey ID和AccessKey Secret。
  * AccessKey Secret：阿里云主账号或对应RAM用户的AccessKey ID和AccessKey Secret。登录阿里云物联网平台控制台，将鼠标移至账号头像上，然后单击AccessKey管理，获取AccessKey ID和AccessKey Secret。
* 通过 RAM角色授权的RAM用户：此种模式适用于通过RAM角色授权一个其他RAM账号来访问数据源，需要配置如下参数：
  * STS Endpoint：STS Token获取服务接入点。具体信息，请参见[阿里云服务接入点](https://www.alibabacloud.com/help/zh/ram/developer-reference/api-sts-2015-04-01-endpoint)
  * STS AccessKey ID：扮演数据持有企业阿里云账号下RAM角色的RAM用户的AccessKey ID。
  * STS Role ARN：数据持有企业的阿里云账号下要扮演的RAM角色ARN，格式为 `acs:ram::<account-id>:role/<role-name>`

## 注意事项

* 确保AMQP服务器的安全性和稳定性，合理配置认证和授权机制。
* 保护您的凭证信息，避免泄露给未经授权的人员。
* 配置时，请参考AMQP服务器的相关文档和支持资源以确保正确性。
* 配置后，可以使用“测试连通”功能验证数据源的可访问性和配置信息的正确性。
* 验证无误后，您可以在数据同步任务中选择此AMQP数据源，执行数据读取导出。

请确保您已阅读并遵循上述指南，以顺利完成AMQP数据源的配置。如果需要进一步的帮助，请参阅相关文档或联系技术支持。
