# 使用SQLAlchemy连接并使用Clickzetta Lakehouse

## 简介

SQLAlchemy 是 Python 编程语言中的一个 SQL 工具箱和对象关系映射（ORM）系统。它为 Python 应用程序开发提供了全面而灵活的 SQL 功能，使得数据库操作更加便捷。Clickzetta Lakehouse 作为一款高性能的数据仓库服务，现已支持 SQLAlchemy，使得用户可以更加轻松地进行数据操作和分析。

## 安装

要使用 SQLAlchemy 连接 Clickzetta Lakehouse，首先需要在您的 Python 环境中安装 clickzetta-sqlalchemy 包。使用以下命令进行安装（确保当前环境中没有安装 clickzetta-sqlalchemy 和 clickzetta-connector，如有需要请先卸载以避免依赖冲突）：

```
pip uninstall -y clickzetta-sqlalchemy clickzetta-connector && pip install clickzetta-connector -U
```

## 配置连接参数

在使用 SQLAlchemy 连接 Clickzetta Lakehouse 时，需要提供正确的连接参数。连接参数的格式如下：

```
clickzetta://<user_login_name>:<password>@<instance_name>.<region_id>.api.clickzetta.com/<workspace_name>?schema=<target_schema>&virtualcluster=<your_vcluster_name>
```

其中，各参数的含义如下：

* `<user_login_name>`：您的 Clickzetta Lakehouse 登录用户名。
* `<password>`：您的 Clickzetta Lakehouse 登录密码。
* `<instance_name>`：您的 Clickzetta Lakehouse 实例名称。
* `<region_id>`：服务实例所在的云厂商及区域的代码，例如：cn-shanghai-alicloud。所有 region_id 详见 [云服务和地域](Supported_Cloud_Platforms.md)。
* `<workspace_name>`：您的 Clickzetta Lakehouse 工作空间名称。
* `<target_schema>`：您希望访问的目标模式（schema）名称。
* `<your_vcluster_name>`：您的虚拟集群（virtual cluster）名称。

**连接示例**：

```
clickzetta://Alice:xxxx@1a2b3c4d.cn-shanghai-alicloud.api.clickzetta.com/myworkspace?schema=public&virtualcluster=default_vc
```

## 使用Apache Superset连接Clickzetta Lakehouse

在本节中，我们将介绍如何使用 Apache Superset 连接 Clickzetta Lakehouse 并进行数据查询及 BI 分析。

### 前置条件

* 确保已成功安装 clickzetta-sqlalchemy 包。
* 确保 Apache Superset 已成功安装并启动。

### 配置连接

1. 打开 Apache Superset，进入数据库列表页面。
2. 点击右上角的“添加数据库”按钮，选择“其他”数据库类型。
3. 在“SQLALCHEMY URI”字段中，填写上述配置的 Clickzetta Lakehouse 连接参数。
4. 点击“测试连接”，确保连接成功。

![配置Superset连接](.topwrite/assets/image_1668962209871.png)

### 数据查询及BI分析

连接成功后，您可以使用 Apache Superset 进行数据查询和 BI 分析。例如：

1. 创建一个新的仪表板，并添加图表组件。
2. 在图表配置页面中，选择刚刚配置的 Clickzetta Lakehouse 数据库连接。
3. 编写 SQL 查询语句，例如：

```sql
SELECT
  orders.order_id,
  orders.customer_id,
  orders.order_date,
  orders.total
FROM
  orders
WHERE
  orders.order_date BETWEEN '2022-01-01' AND '2022-12-31';
```

4. 点击“执行查询”，查看查询结果。
5. 根据需要调整图表样式和配置，完成BI分析。

![Superset数据查询及BI分析](.topwrite/assets/image_1668962386077.png)

通过以上步骤，您可以轻松地使用 Apache Superset 连接 Clickzetta Lakehouse，实现数据查询和 BI 分析。
