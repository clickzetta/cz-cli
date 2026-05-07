Lakehouse 实现了 MySQL 客户端与服务端的通讯协议，因此可以使用 MySQL 驱动连接 Lakehouse。然而，Lakehouse 并未实现 MySQL 的语法和数据类型。您可以通过 MySQL 客户端连接到 Lakehouse，但执行的 SQL 语句应使用 Lakehouse 语法，而非 MySQL 语法。例如，`mysqldump` 命令在 Lakehouse 中不可用。本文使用 PowerBI 中的 MySQL 驱动连接 Lakehouse，快速了解如何连接 Lakehouse。我们使用财务示例数据集。

## 准备工作

* 目前需要重置密码，即使是新建的账号也需要重置密码。这是因为 MySQL 5.x 版本使用的是 `mysql_native_password` 密钥，而 Lakehouse 需要保存 MySQL 的加密算法。目前，只有在修改密码时，Lakehouse 才会保存 MySQL 密钥的加密算法。您可以修改密码时保持和之前一样这样可以避免影响别的任务连接

* 给用户设置计算集群，由于 MySQL 协议中没有传入设置集群的方式，用户可以使用 SQL 命令为用户添加一个默认计算集群。这样在 MySQL 连接时就会使用该集群。需要注意的是，BI场景对分析性能往往有要求，建议为BI工具连接用户选择合适规格的分析型计算集群以提供最佳的查询性能。

  ```SQL
   ALTER USER user_name SET DEFAULT_VCLUSTER = default_ap;
    
   -- 查看集群设置是否生效
   SHOW USERS;
  ```

* 准备用户名。 MySQL 协议连接地址时只能传入一个 URL，无法拼接 Lakehouse 的 instance name 和 workspace name，因此需要将 instance name 和 workspace name 拼接到用户名中。

  *   用户名格式要求如下：

  * ```Plain
    登录的账号名称@instance_name.workspace_name
    ```

  * **instance\_name 获取**：在 工作空间页面 中获取 JDBC 连接串。例如，在 `jdbc:clickzetta://``jnsxwfyr.api.clickzetta.com/quick_start?virtualCluster=default` 中，`jnsxwfyr` 为 instance\_name。

    * ![](.topwrite/assets/image_1723468458225.png)

  * **workspace\_name 获取**：工作空间的名称。

* 在 Lakehouse 中创建 schema 和 table，并上传数据。

```Plain
create schema sales;
use sales;
create table salesdata (
    segment varchar(255),
    country varchar(255),
    product varchar(255),
    discountband varchar(255),
    unitssold decimal(10, 2),
    manufacturingprice decimal(10, 2),
    saleprice decimal(10, 2),
    grosssales decimal(15, 2),
    discounts decimal(15, 2),
    sales decimal(15, 2),
    cogs decimal(15, 2),
    profit decimal(15, 2),
    date date,
    monthnumber int,
    monthname varchar(50),
    year int
);
```

## 连接 PowerBI

* 点击获取数据源，搜索 MySQL

![](.topwrite/assets/image_1723468519288.png)

* 输入 Lakehouse 的 MySQL 连接地址和 schema 名称，本次案例的 schema 是 public。

  * ![](.topwrite/assets/image_1723468556557.png)

每个region的连接地址

| 云服务商 | 地域  | 连接地址                                               |
| ---- | --- | -------------------------------------------------- |
| 阿里云  | 上海  | cn-shanghai-alicloud-mysql.api.clickzetta.com      |
| 腾讯云  | 上海  | ap-shanghai-tencentcloud-mysql.api.clickzetta.com  |
|      | 北京  | ap-beijing-tencentcloud-mysql.api.clickzetta.com   |
|      | 广州  | ap-guangzhou-tencentcloud-mysql.api.clickzetta.com |
| 亚马逊  | 北京  | cn-north-1-aws-mysql.api.clickzetta.com            |


* 配置用户名密码，MySQL 协议连接地址时只能传入一个 URL，无法拼接 Lakehouse 的 instance name 和 workspace name，因此需要将 instance name 和 workspace name 拼接到用户名中。，用户名格式要求如下：

```Plain
登录的账号名称@instance_name.workspace_name
```

![](.topwrite/assets/image_1723468581688.png)

* 获取Lakehouse表

![](.topwrite/assets/image_1723468606603.png)

* 配置仪表盘

![](.topwrite/assets/image_1723468624662.png)

* 将仪表盘发布到 Power Service

* 在 Power Service 中找到刚发布的仪表盘，配置调度信息和密码认证信息。

  * ![](.topwrite/assets/image_1723468643893.png)

  * 编辑用户名密码

    * ![](.topwrite/assets/image_1723468662518.png)
    * ![](.topwrite/assets/image_1723468680533.png)

  * 编辑调度信息

  * ![](.topwrite/assets/image_1723468702158.png)

* 在 Power Service 查看仪表盘

![](.topwrite/assets/image_1723468715463.png)

## 资料

[使用MySQL协议连接](use-mysql-client.md)
