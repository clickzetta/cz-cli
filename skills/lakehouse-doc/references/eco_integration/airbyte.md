# Airbyte Clickzetta Destination 插件使用指南

## 引言

Airbyte 是一款开源数据同步工具，它能够将各类数据源与数据仓库进行高效对接。通过 Airbyte，用户可以轻松实现数据的抽取、转换和加载（ETL），从而满足数据集成的需求。

本文旨在帮助用户了解如何在 Airbyte 中配置和使用 Clickzetta Lakehouse 目标插件，实现数据的高效同步。在阅读本文前，您可能需要对 Airbyte 的基本概念有所了解。如果您还不熟悉 Airbyte，建议参考其[官方文档](https://docs.airbyte.com/category/getting-started)。

## 插件特性

Clickzetta Lakehouse 目标插件支持以下同步模式：

1. 全量刷新同步（Full Refresh Sync）
2. 增量追加同步（Incremental - Append Sync）
3. 增量追加去重同步（Incremental - Append + Deduped）

## 安装插件

Airbyte 支持多种部署方式，包括单机和 Kubernetes（k8s）集群。在部署好 Airbyte 后，请按照以下步骤操作：

1. 登录 Airbyte 控制台。
2. 进入 Settings 页面，选择 Destinations。
3. 点击 New connector 按钮，进入新增目标连接器界面。
4. 填写相关信息：
   - Connector display name：为您的连接器设置一个易于识别的名称，例如 "Clickzetta Lakehouse"。
   - Docker repository name：输入 "clickzetta/clickzetta-airbyte"。
   - Docker image tag：从 [Docker Hub](https://hub.docker.com/r/clickzetta/clickzetta-airbyte/tags) 查询并输入最新的镜像版本号。
   - Connector documentation URL：可将本文的链接填写于此，以便随时查阅。
5. 点击 Add 按钮，稍等片刻，插件即配置完成。

## 配置插件

在 Airbyte 中创建 Source、Destination 和 Connection 对象，具体步骤可参考 [官方文档](https://docs.airbyte.com/quickstart/set-up-a-connection)。以下是针对 Clickzetta Lakehouse 目标连接器的配置说明：

1. 在 Airbyte 控制台，进入 Destination 页面。
2. 点击 New destination 按钮，创建新的目的地对象。
3. 选择 Clickzetta Lakehouse 连接器。
4. 填写配置信息：
   - Username：您的 Clickzetta Lakehouse 用户名。
   - Password：对应的用户密码。
   - Service：服务地址，例如 "api.clickzetta.com"。
   - Instance：实例名称。
   - Workspace：空间名称，如 "quickstart_ws"。
   - VirtualCluster：集群名称，如 "default"。Airbyte 将使用此集群的计算资源执行 ELT 的 Transform SQL。
   - Schema（可选）：默认为 "public"，如有需要可修改。
   - Normalization：选择 "Normalized tabular data"，以便将数据还原为源表的 schema。
   - Split size：设置 Normalization SQL 执行时的切片大小。建议保留默认值，以避免影响性能。

## 使用示例

以下是几个典型的使用场景，帮助您更好地理解如何使用 Clickzetta Lakehouse 目标插件：

### 示例 1：全量同步数据

1. 创建一个 Source 对象，连接您的数据源。
2. 创建一个 Destination 对象，配置 Clickzetta Lakehouse 连接器。
3. 创建一个 Connection 对象，关联 Source 和 Destination。
4. 在 Connection 配置中，选择 Full Refresh Sync 同步模式。
5. 启动 Connection，Airbyte 将全量同步数据至 Clickzetta Lakehouse。

### 示例 2：增量同步并去重

1. 按照示例 1 的步骤配置 Source、Destination 和 Connection 对象。
2. 在 Connection 配置中，选择 Incremental - Append + Deduped 同步模式。
3. 设置 Incremental 触发条件，例如基于时间戳或记录 ID。
4. 启动 Connection，Airbyte 将增量同步数据，并自动去重。

## 总结

本文详细介绍了如何在 Airbyte 中配置和使用 Clickzetta Lakehouse 目标插件。通过遵循上述步骤和示例，您可以轻松实现数据的高效同步。

## 参考资料

- [Airbyte 官方文档](https://docs.airbyte.com/category/getting-started)
- [Airbyte ELT 实现及各种同步模式解析](https://airbyte.com/tutorials/incremental-data-synchronization)