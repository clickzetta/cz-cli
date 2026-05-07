# Hive 数据源配置指南

## 概述

Hive 是基于 Hadoop 生态系统的数据仓库软件，它提供了一种 SQL 接口（HiveQL）来查询和管理大规模数据集。通过配置 Hive 数据源，您可以实现与其他系统的数据同步和复杂的数据分析任务。

## 参数配置

配置 Hive 数据源时，需要提供以下信息以确保成功连接到 Hive 服务：

* **数据源名称**：为您的 Hive 数据源指定一个唯一且易于识别的名称。
* **HiveServer 连接信息**：提供 HiveServer 的 JDBC 连接 URL，通常格式为 `jdbc:hive2://host:port/database`。例如，`jdbc:hive2://hive-server:10000/default`。
* **登录模式**：选择是否使用匿名认证。如果选择匿名，则不需要提供用户名和密码；否则，必须填写用户名和密码。
* **用户名**：如果非匿名认证，提供连接数据库需要的用户名。
* **密码**：对应用户名的数据库访问密码。
* **defaultFS**：提供 HDFS 的默认文件系统地址，对应 core-site.xml 文件中的 `fs.defaultFS` 参数。
* **hiveVersion**（可选）：指定 Hive 的版本信息。
* **hiveMetaStoreUri**（可选）：指定 Hive Metastore 的连接 URI。
* **扩展参数**（可选）：如需，可提供其他 Hadoop 相关配置参数，例如 NameNode 地址等。

```JSON
{
    "hadoop.user.name": "datadev",
    "dfs.ha.namenodes.zetta-cluster": "nn1,nn2",
    "dfs.namenode.rpc-address.zetta-cluster.nn1": "test-01:8020",
    "dfs.nameservices": "zetta-cluster",
    "dfs.namenode.rpc-address.zetta-cluster.nn2": "test-02:8020"
}
```

* **认证方式**：选择认证方式，提供两种选项：“无”和“Kerberos 认证”。
  * 如果选择“无”，则无需提供额外的认证信息。
  * 如果选择“Kerberos 认证”，则需要提供以下 Kerberos 认证信息：
    * 用户名：用于 Kerberos 认证的用户主体（Principal）。
    * 密码：对应用户主体的密码。
    * Kerberos 密钥表文件（可选）：如果使用密钥表（Keytab）文件进行认证，请提供该文件的路径。

## 连接配置

在连接配置方面，您可以选择以下连接方式之一：

* **直连**：确保您输入的连接信息在公网可访问。如果源端开启了IP访问白名单，请确保数据集成服务的出口IP地址已被加入到白名单中，具体IP地址请联系技术支持人员。
* **通过 SSH 隧道**：为了提高安全性，您可以选择通过 SSH 隧道连接到 Hive。启用此选项后，需要提供 SSH 服务器的 IP 地址和端口。请确保 SSH 客户端已正确配置，并且您有权限通过 SSH 连接到 Hive 服务器。

## 注意事项

* 确保所有提供的连接信息准确无误，并且 Hive 服务是可访问的。
* 请妥善保护您的数据库凭证信息，避免泄露给未经授权的人员。
* 定期检查并更新您的数据源配置，以适应数据库结构的变化或新的安全要求。
* 监控数据同步任务的运行状态，以便及时发现并解决可能出现的问题。

完成配置后，您即可在数据同步任务中选择此 Hive 数据源，进行数据的导入或导出操作。通过 SSH 隧道连接可以增强数据传输的安全性，特别适用于处理敏感数据的场景。
