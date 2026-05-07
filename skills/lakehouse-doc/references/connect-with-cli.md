# Clickzetta Lakehouse 命令行客户端使用指南

本文旨在帮助您了解如何安装、配置和使用 Clickzetta Lakehouse 命令行客户端。通过本指南，您将能够顺利连接到 Clickzetta Lakehouse 服务实例，并执行各种 SQL 命令。

## 前提条件

在开始使用客户端之前，请确保满足以下条件：

1. 您的设备已安装 Java 8 或更高版本。
2. 您已在 Clickzetta 官网注册账户，并创建了 Lakehouse 服务实例。
3. 您已创建用于连接访问的工作空间。
4. 使用客户端的用户身份已被添加至工作空间，并被授权访问。

## 安装客户端

Clickzetta Lakehouse 的命令行客户端基于开源 SQL Line 项目进行二次开发。请按照以下步骤安装并配置客户端：

1. 从公网下载或通过Clickzetta工作人员获取客户端安装包[sqlline\_cz.tar.gz](https://autolake-dev-beijing.oss-cn-beijing.aliyuncs.com/clickzetta-tool/release/sqlline_cz.tar.gz)。
2. 解压安装包文件，您将获得客户端工具的可执行文件和配置文件。

```
% tar -zxvf sqlline_cz.tar.gz
x sqlline_cz/
x sqlline_cz/example.properties
x sqlline_cz/log4j.properties
x sqlline_cz/setup.sh
x sqlline_cz/sqlline
x sqlline_cz/sqlline-2.13.0-SNAPSHOT-jar-with-dependencies.jar
```

## 初始化连接环境

1. 进入工作目录：

```
cd sqlline_cz
```

2. 初始化连接环境：
   主要作用是下载最新的 JDBC 驱动包并放到 `sqlline_cz` 目录下。您也可以通过下方链接下载最新的 JDBC 驱动包，并放到 `sqlline_cz` 目录下。

* [下载地址一](https://mvnrepository.com/artifact/com.clickzetta/clickzetta-java)
* [下载地址二](https://central.sonatype.com/artifact/com.clickzetta/clickzetta-java/versions)

```
sh setup.sh
```

## 配置客户端连接

### 方式1：命令行指定连接参数

通过命令行指定连接参数的方式如下：

```
sh sqlline -d com.clickzetta.client.jdbc.ClickZettaDriver -u "<JDBC URL>" -n <user_name> -p <password>
```

JDBC URL 格式：

```
jdbc:clickzetta://<instance_name>.<region_id>.api.clickzetta.com/<workspace_name>?schema=<默认schema名称>&virtualCluster=<计算集群名称>
```

参数说明：

* `<JDBC URL>`：当前服务实例的 JDBC 连接串，详细格式详见 [JDBC驱动](JDBC-Driver.md)。
* `<user_name>`：目标工作空间中的空间成员的用户名。
* `<password>`：目标工作空间中的空间成员的密码。
* `schema`：指定要连接的 schema，必须填写。
* `virtualCluster`：使用的计算资源，必须填写。

示例：

```
sh sqlline -d com.clickzetta.client.jdbc.ClickZettaDriver -u "jdbc:clickzetta://<lakehouse_instance_name>.cn-shanghai-alicloud.api.clickzetta.com/<workspace_name>?schema=<target_schema_name>&vcluster=<your_virtualcluster_name>" -n <user_name> -p <your_password>
```

### 方式2：命令行指定配置文件

命令行工具提供了配置文件模板。您可以修改该配置文件，然后在命令行中指定该文件以实现服务连接。样例配置文件格式如下：

```
url=jdbc:clickzetta://<Lakehouse_instance_name>.<region_id>.api.clickzetta.com/<workspace_name>?schema=<schma_name>&virtualCluster=<vcluster_name>
driver=com.clickzetta.client.jdbc.ClickZettaDriver
user=<your_user_name>
password=<your_password>
```

根据您的服务信息修改模板配置文件并保存后，通过命令参数指定配置文件的方式进行服务连接。

```
$ sh sqlline properties <配置文件名>
```

示例：

```
$ sh sqlline properties test.properties
sqlline version 1.13.0-SNAPSHOT
0: jdbc:clickzetta://xxxx.region_id.api.clickzetta.com>show tables;
```

Clickzetta Lakehouse 命令行工具可一次创建多个不同的服务连接配置文件。在使用过程中，可借助 `!properties` 命令快速切换不同配置文件对应的服务连接。以下以将配置文件从 test.properties 切换为 test.properties.1 为例：

```
sqlline> !properties test.properties
Transaction isolation level TRANSACTION_REPEATABLE_READ is not supported. Default (TRANSACTION_READ_COMMITTED) will be used instead.
0: jdbc:clickzetta://xxxx.region_id.api.clickzetta.com> !properties test.properties.1
Transaction isolation level TRANSACTION_REPEATABLE_READ is not supported. Default (TRANSACTION_READ_COMMITTED) will be used instead.
1: jdbc:clickzetta://yyyyy.region_id.api.clickzetta.com> !go 0
0: jdbc:clickzetta://xxxx.region_id.api.clickzetta.com>
```

## 运行SQL命令

连接成功后，您可以在命令行客户端执行 Lakehouse SQL 命令。以下是一些SQL命令示例：

切换要使用的 vcluster 和 schema

```
use vcluster default;
use schema nyc_taxi_data;
```

查看当前 schema 中有哪些表

```
show tables;
```

![](.topwrite/assets/image_1699879449976.png)
查询数据

```
select  * from fhv_trips_staging limit 10;
```

![](.topwrite/assets/image_1699879794959.png)

## 退出客户端

```
!quit
```

## 备注

通过在当前环境中设置以下环境变量，可以打开 debug 模式并输出日志文件，方便问题排查。

```
export SQLLINE_DEBUG_ENABLE=TRUE
```

^
