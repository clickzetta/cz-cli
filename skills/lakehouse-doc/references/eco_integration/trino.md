# Trino Clickzetta Connector 使用指南

## Trino 简介

Trino 是一个高性能的开源分布式 SQL 查询引擎，它支持在多种数据源上执行查询，包括但不限于 Hive、MySQL、PostgreSQL、MongoDB、Redis、Cassandra、Kafka 等。Trino 常用于离线查询加速和多数据源联邦查询，为用户提供便捷的数据处理和分析体验。

本文档将介绍如何使用 Trino-Clickzetta 插件，通过 Trino 直接访问和分析 Clickzetta Lakehouse 中的数据。

## 准备工作

1.  请确保已安装 Trino。您可以选择下载 [Trino 402 版本服务器](https://repo1.maven.org/maven2/io/trino/trino-server/402/trino-server-402.tar.gz)。
2.  下载 Trino-Clickzetta 插件。访问 [插件下载页面](https://autolake-dev-beijing.oss-cn-beijing.aliyuncs.com/clickzetta-tool/release/trino-clickzetta-402.zip)，将插件解压到 Trino 安装目录下的 `plugin` 文件夹中。
3.  下载 Trino-Clickzetta 插件配置文件。访问 [配置文件下载页面](https://autolake-dev-beijing.oss-cn-beijing.aliyuncs.com/clickzetta-tool/release/cziceberg.properties)，将配置文件复制到 Trino 安装目录下的 `etc/catalog` 文件夹中。根据您的实际情况，修改配置文件中的以下三项：
   ```
   iceberg.cz.uri=jdbc:clickzetta://instance.api.clickzetta.com/workspace?schema=public&vcluster=default
   iceberg.cz.user=username
   iceberg.cz.password=password
   ```
4.  启动或重启 Trino 服务。在 Trino 安装目录下执行以下命令：
   ```shell
   bin/launcher start/restart
   ```

## 使用 Trino Clickzetta 插件

1. 使用 Trino 客户端连接至 Trino 服务器。您可以下载 [Trino 客户端](https://repo1.maven.org/maven2/io/trino/trino-cli/402/trino-cli-402-executable.jar)，并参考 [客户端使用指南](https://trino.io/docs/current/client/cli.html) 进行操作。

   ```shell
   java -jar trino-cli-402-executable.jar --server localhost:8080 --catalog cziceberg --schema public
   ```

2. 在 Trino 客户端中，执行以下命令查看 Clickzetta Lakehouse 中的表：

   ```sql
   show tables;
   ```

   您将看到类似于以下的表列表：

   ```
           Table
   ----------------------------
   lh_smoke_test_bulkload
   lh_smoke_test_igs
   spark_src
   spark_src_complex_type
   spark_srcpart
   spark_srcpart_complex_type
   spark_srcpart_date
   spark_srcpart_int
   (8 rows)
   ```

3. 查询表中的数据。例如，查询 `lh_smoke_test_igs` 表中的记录总数：

   ```sql
   select count(*) from lh_smoke_test_igs;
   ```

   结果类似于：

   ```
   _col0
   -------
   100
   ```

## 注意事项

1. 本插件仅针对 Trino 402 版本进行开发和验证。
2. 目前插件仅支持从 Clickzetta Lakehouse 读取数据，不支持写入数据。
3. 插件暂不支持读取在 Clickzetta Lakehouse 中被更新或删除过的表。
4. 有关 Trino 配置文件的详细信息，请参阅 [Trino 官方文档](https://trino.io/docs/current/installation/deployment.html#configuration)。

^
