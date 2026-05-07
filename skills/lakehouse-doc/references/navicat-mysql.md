Navicat（全称 Navicat Premium）是一款功能强大的数据库管理工具，广泛应用于数据库开发、管理和维护。本文介绍如何使用 Navicat 通过 MySQL 协议连接 Lakehouse。

# 准备工作

* 请参考[Navicat官网](https://www.navicat.com/en/download/navicat-premium)，如果已经安装完毕请跳过。

* 使用Mysql协议连接。目前需要重置密码，即使是新建的账号也需要重置密码。这是因为 MySQL 5.x 版本使用的是 `mysql_native_password` 密钥，而 Lakehouse 需要保存 MySQL 的加密算法。目前，只有在修改密码时，Lakehouse 才会保存 MySQL 密钥的加密算法。您可以修改密码时保持和之前一样这样可以避免影响别的任务连接

* 给用户设置计算集群，由于 MySQL 协议中没有传入设置集群的方式，用户可以使用 SQL 命令为用户添加一个默认计算集群。这样在 MySQL 连接时就会使用该集群。

  * ```SQL
    ALTER USER user_name SET DEFAULT_VCLUSTER = default;-- 查看集群设置是否生效SHOW USERS;
    ```

* 准备用户名。 使用 MySQL 协议连接时，地址中只能传入一个 URL，无法拼接 Lakehouse 的 instance_name 和 workspace_name。因此，需要将 instance_name 和 workspace_name 拼接到用户名中。

  * 用户名格式要求如下：
  * ```Plain
    登录的账号名称@instance_name.workspace_name
    ```
  * **instance_name 获取**：在 工作空间页面 中获取 JDBC 连接串。例如，在 `jdbc:clickzetta://``demoinstance.cn-shanghai-alicloud.api.clickzetta.com/quick_start?virtualCluster=default` 中，`jnsxwfyr` 为 instance\_name。
  * **workspace\_name 获取**：工作空间的名称。

# 连接Lakehouse

* 点击连接->选择MySQL

* 填写配置信息，如下

| 字段       | 说明                                                    |
| -------- | ----------------------------------------------------- |
| **连接名称** | 自定义连接名称如：clickzetta\_lakehouse\_mysql                 |
| **主机**   | 每个region的连接地址，具体参考[使用MySQL协议连接 ](use-mysql-client.md) |
| **端口**   | 可选。默认值:3306                                           |
| **用户名**  | 登录的账号名称@instance\_name.workspace\_name                |
| **密码**   | 登录账号的密码                                               |

# 在Navicat中查询Lakehouse数据

```sql
 select
    l_returnflag,
    l_linestatus,
    sum(l_quantity) as sum_qty,
    sum(l_extendedprice) as sum_base_price,
    sum(l_extendedprice * (1 - l_discount)) as sum_disc_price,
    sum(l_extendedprice * (1 - l_discount) * (1 + l_tax)) as sum_charge,
    avg(l_quantity) as avg_qty,
    avg(l_extendedprice) as avg_price,
    avg(l_discount) as avg_disc,
    count(*) as count_order
from
    clickzetta_sample_data.tpch_100g.lineitem
where
    l_shipdate <= date '1998-12-01' - interval '85' day
group by
    l_returnflag,
    l_linestatus
order by
    l_returnflag,
    l_linestatus
limit 1;
```

^
