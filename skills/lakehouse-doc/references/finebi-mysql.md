帆软BI（FineBI） 是帆软软件有限公司推出的一款商业智能（Business Intelligence）产品。FineBI 是新一代大数据分析的 BI 工具，旨在帮助企业的业务人员充分了解和利用他们的数据。本文介绍使用Mysql协议来连接Lakehouse

# 准备工作

* 请参考[FineBI官网](https://www.finebi.com/)，如果已经安装完毕请跳过。

* 使用Mysql协议连接。目前需要重置密码，即使是新建的账号也需要重置密码。这是因为 MySQL 5.x 版本使用的是 `mysql_native_password` 密钥，而 Lakehouse 需要保存 MySQL 的加密算法。目前，只有在修改密码时，Lakehouse 才会保存 MySQL 密钥的加密算法。您可以修改密码时保持和之前一样这样可以避免影响别的任务连接

* 给用户设置计算集群，由于 MySQL 协议中没有传入设置集群的方式，用户可以使用 SQL 命令为用户添加一个默认计算集群。这样在 MySQL 连接时就会使用该集群。

  * ```SQL
    ALTER USER user_name SET DEFAULT_VCLUSTER = default;-- 查看集群设置是否生效SHOW USERS;
    ```

* 准备用户名。 MySQL 协议连接地址时只能传入一个URL无法拼接Lakehouse的instace name和worksapce name,因此需要将。instace name和worksapce name拼接到用户名中

  *   用户名格式要求如下：

  * ```Plain
    登录的账号名称@instance_name.workspace_name
    ```

  * **instance\_name 获取**：在 工作空间页面 中获取 JDBC 连接串。例如，在 `jdbc:clickzetta://``jnsxwfyr.api.clickzetta.com/quick_start?virtualCluster=default` 中，`jnsxwfyr` 为 instance\_name。
  * **workspace\_name 获取**：工作空间的名称。

# 在帆软BI（FineBI）配置连接Lakehouse

* 在数据连接->数据连接管理中->新建数据连接->选择MySQL
* 填写配置信息，如下图案例

|     字段名称       |   说明                                                                                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **数据连接名称**  | 自定义连接名称如：clickzetta\_lakehouse\_mysql                                                                                                                                                                                  |
| **驱动**      | 使用默认值即可：com.mysql.jdbc.Driver                                                                                                                                                                                          |
| **数据库名称**   | Lakehouse的Schema名称如public                                                                                                                                                                                              |
| **主机**      | 每个region的连接地址，具体参考[使用MySQL协议连接](<use-mysql-client.md>)                                                                                                                                                                                          |
| **端口**      | 可选。默认值:3306                                                                                                                                                                                                            |
| **用户名**     | 登录的账号名称@instance\_name.workspace\_name                                                                                                                                                                                 |
| **密码**      | 登录账号的密码                                                                                                                                                                                                                |
| **编码**      | 默认值                                                                                                                                                                                                                    |
| **数据连接URL** | fineBI会自动根据上面的连接信息生成URL。您需要编辑该URL在末尾添加`?useSSL=false`必须添加该参数才能连通。如下案例`jdbc:mysql://``cn-shanghai-alicloud-mysql.api.clickzetta.com/dws_clys?useSSL=false`，添加完该参数后数据库名称之后也会增加`?useSSL=false`这是正常的如`public?useSSL=false` |

# 验证连接

## 通过创建服务器数据集

导航到数据连接->服务器数据集，创建新的SQL数据集。

数据集名称：云器Lakehouse-TPCH-Q01

SQL语句：

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

:-: ![](.topwrite/assets/image_1736938941276.png =657)

## 创建数据集

选择新建数据集->SQL数据集：

:-: ![](.topwrite/assets/image_1736939075914.png =660)

表明云器Lakehouse里的表对帆软BI的“公共数据”可用。

在分析主题中使用Lakehouse里的数据：

:-: ![](.topwrite/assets/image_1736939239963.png =657)

## 分析视图

通过拖拉拽生成新的数据视图

:-: ![](.topwrite/assets/image_1736994382813.png =660)

基于数据视图的可视化组件-饼图，分析不同发动机类型的二手车销售额

:-: ![](.topwrite/assets/image_1736994510861.png =665)

基于数据视图的可视化组件-交叉表，分析不同发动机的二手车逐年销售额

:-: ![](.topwrite/assets/image_1736994646263.png =669)
