# 简介

> 【预览发布】本功能当前处于公开预览发布阶段。

| 云服务商 | 地域  | 兼容MySQL协议版本       |
| ---- | --- | ----------------- |
| 阿里云  | 新加坡 | MySQL5.x和MySQL8.x |
|      | 上海  | MySQL5.x和MySQL8.x |
| 腾讯云  | 上海  | MySQL8.x          |
|      | 北京  | MySQL8.x          |
|      | 广州  | MySQL8.x          |
| 亚马逊  | 北京  | MySQL8.x          |
|      | 新加坡 | MySQL8.x          |

Lakehouse 支持 MySQL 客户端与服务端的通讯协议，因此可以使用 MySQL 驱动连接 Lakehouse。然而，Lakehouse 并未实现 MySQL 的语法和数据类型。通过 MySQL 客户端连接 Lakehouse 时，执行的 SQL 语句应使用 Lakehouse 语法，而非 MySQL 语法。例如，`mysqldump` 命令在 Lakehouse 中不可用。

为了适配一些 BI 报表，Lakehouse 实现了一些 MySQL 常用函数，如 `str_to_date` 和 `date_format`。目前，Lakehouse 支持的协议如下：
MySQL8.x版本客户端连接服务端时默认使用的是caching\_sha2\_password认证方式，有关 MySQL 认证方式的更多信息请参考[官方文档](https://dev.mysql.com/doc/refman/8.0/en/authentication-plugins.html)。连接方式如下，例如连接上海阿里云：

```
jdbc:mysql://cn-shanghai-alicloud-mysql.api.clickzetta.com/public
--添加端口,可选
jdbc:mysql://cn-shanghai-alicloud-mysql.api.clickzetta.com:3306/public
--使用ssl可选
jdbc:mysql://cn-shanghai-alicloud-mysql.api.clickzetta.com/public?useSSL=true
```

MySQL5.x版本客户端连接服务端时默认使用的是mysql\_native\_password认证方式，有关 MySQL 认证方式的更多信息请参考[官方文档](https://dev.mysql.com/doc/refman/8.0/en/authentication-plugins.html)，连接Lakehouse是无需开启SSL，连接方式如下，例如连接上海阿里云：。

* 目前需要重置密码，即使是新建的账号也需要重置密码。这是因为 MySQL 5.x 版本使用的是 `mysql_native_password` 密钥，而 Lakehouse 需要保存 MySQL 的加密算法。目前，只有在修改密码时，Lakehouse 才会保存 MySQL 密钥的加密算法。您可以在修改密码时保持和之前一样，这样可以避免影响其他任务的连接。

```
jdbc:mysql://cn-shanghai-alicloud-mysql.api.clickzetta.com/public?useSSL=false
--添加端口,可选
jdbc:mysql://cn-shanghai-alicloud-mysql.api.clickzetta.com:3306/public?useSSL=false
```

端口：3306（可选）

# 使用场景

* 无法使用Lakehouse驱动场景，比如某些报表场景不支持自定义jdbc驱动或者不支持Lakehoue原生jdbc驱动。如果可以，请尽可能使用 Lakehouse 原生驱动。

# 使用限制

* 目前无法完全兼容MySQL函数和语法，某些报表使用的一些 MySQL 专有语法和函数在发送到 Lakehouse 时会报错（请联系 Lakehouse 支持）。
* 数据类型限制
  * 在使用 Lakehouse MySQL 协议时，若 SQL 语句中包含 MySQL 特有的类型（如 mediumint、numeric、bit、time、year、datetime、varbinary、text、blob、enum、set、空间数据类型），系统会报错。例如，“create table mysql\_table(col numeric)” 的建表语句，或 “select cast(xxxx as text)” 这类语句，只要 SQL 中含有上述类型，都会触发报错。为避免此问题，可使用 Lakehouse 的类型替换 MySQL 的数据类型。
* 语法限制
  * 不支持MySQL特有语法如MySQL dump命令、Load等命令。
* 函数限制
  * Lakehouse 实现了一些 MySQL 常用函数。如果您有需要请联系Lakehouse支持
* 数据导入限制
  * 不支持 MySQL 批量导入数据，例如 MySQL 的 LOAD 命令。
  * 使用MySQL驱动不支持Lakehouse本地命令（[PUT](PUT.md)、[REMOVE](remove-volume.md)、[GET](GET.md)等命令），不支持使用MySQL驱动调用Lakehouse的批量上传和实时上传数据的Java SDK。
* MySQL列出表结构时需要查询information schema，目前Lakehouse对于新建的表在information schema会存在15分钟延迟，所以新建的表无法立即看到

# 连接方式

## 1.设置计算集群

由于 MySQL 协议中没有传入设置集群的方式，用户可以使用 SQL 命令为用户添加一个默认计算集群。这样在 MySQL 连接时就会使用该集群。需要注意的是，BI场景对分析性能往往有要求，建议为BI工具连接用户选择合适规格的分析型计算集群以提供最佳的查询性能。

```sql
ALTER USER user_name SET DEFAULT_VCLUSTER = default;

-- 查看集群设置是否生效
SHOW USERS;
```

## 2.设置用户名密码

由于 MySQL 协议中没有 workspace 名称和 instance 名称，因此需要将 instance 名称和 workspace 名称拼接到用户名中。

用户名格式要求如下：

```
登录的账号名称@instance_name.workspace_name
```

* **instance\_name 获取**：在 [工作空间](workspace-introduction.md)页面 中获取 JDBC 连接串。例如，在 `jdbc:clickzetta://jnsxwfyr.api.clickzetta.com/quick_start?virtualCluster=default` 中，`jnsxwfyr` 为 instance\_name。
* **workspace\_name 获取**：工作空间的名称。

示例：

```
user@jnsxwfyr.quick_start
```

## 3.设置连接地址：

端口：3306

| 云服务商 | 地域 | 连接地址                                               |
| ---- | -- | -------------------------------------------------- |
| 阿里云  | 上海 | cn-shanghai-alicloud-mysql.api.clickzetta.com      |
| 腾讯云  | 上海 | ap-shanghai-tencentcloud-mysql.api.clickzetta.com  |
|      | 北京 | ap-beijing-tencentcloud-mysql.api.clickzetta.com   |
|      | 广州 | ap-guangzhou-tencentcloud-mysql.api.clickzetta.com |
| 亚马逊  | 北京 | cn-north-1-aws-mysql.api.clickzetta.com            |

## 4.其他参数：

* useSSL=true：Lakehouse对于mysql 8.x版本客户端时使用caching\_sha2\_password，因此使用mysql 8.x版本驱动连接时必须设置useSSL=true。如果使用的是mysql5.x版本则useSSL=false即可
* 数据库名称: Lakehouse的schema名称
* 端口：3306（可选）

# 一般BI报表配置参数

**连接工具**

建议mysql java 8.0驱动，运行SQL，但是某些报表可能初始化会发一些mysql特有的语法，如果遇到报错请联系Lakehouse技术支持。

**设置vcluster**:
需要给连接的用户指定默认vcluster，在Lakehouse中指定用户默认vcluster,这样在 MySQL 连接时就会使用该集群。需要注意的是，BI场景对分析性能往往有要求，建议为BI工具连接用户选择合适规格的分析型计算集群以提供最佳的查询性能。

```SQL
ALTER USER user_name SET DEFAULT_VCLUSTER= default_ap;
--查看vcluster设置是否生效
show users;
```

**驱动要求**：建议mysql8.0以上

**连接地址（必须配置**）

**用户名格式（必须配置**）

* 格式：用户名@instance\_name.worksapace\_name，比如test\@jnsxwfyr.ql\_ws

**数据库名称（必须配置**）

* 格式：schema名称，如public

**端口：3306。某些报表需要配置**

**额外参数（必须配置**）：

如果使用 8.x 驱动，某些报表可以直接在配置参数中输入下面字符串：

* useSSL=true

如果报表中不支持填写参数

* 在报表界面，通常可以找到是否使用 SSL 的选项，需要勾选上。
  如果使用的是 5.x 版本驱动，则不需要勾选。

# 常见问题

* 无法指定计算资源

  * 需要给连接的用户指定默认vcluster，在Lakehouse中指定用户默认vcluster
  * ```SQL
    alter user UAT_TEST set DEFAULT_VCLUSTER= default;
    --查看vcluster设置是否生效
    show users;
    ```

# 问题排查

通过lakehouse作业历史排查问题。如果mysql协议连通之后，mysql连接Lakehouse通常会发一些SQL，作业历史会记录发送的SQL，此时我们可以通过作业历史查看发送的SQL来看错误信息。通过筛选来快速定位，如下三个筛选条件

* 计算集群：bi报表中指定的计算集群
* 提交人：bi报表中连接的用户名比如是<<<test@jnsxwfyr.ql_ws>>>，则这里筛选为test
* schema：bi报表中指定的schema名称
* 通过点击右上角的刷新按钮，来监控 BI 报表发送的 SQL。

![](.topwrite/assets/image_1722596643860.png)

# 案例

* 使用mysql client 连接

mysql client连接Lakehouse：

```
-- 添加-A选项避免mysql连接时发送一些校验的SQL
mysql -h cn-shanghai-alicloud-mysql.api.clickzetta.com -u user_name@instance_name.worksapace_name -D  public -p -A

--使用mysql客户端连接报错信息为：ERROR 2059 (HY000): Authentication plugin 'mysql_clear_password' cannot be loaded: plugin not enabled时。可以添加参数使用以下命令来连接
mysql -h cn-shanghai-alicloud-mysql.api.clickzetta.com -u user_name@instance_name.worksapace_name -Dpublic -p -A --enable-cleartext-plugin  --default-auth=mysql_native_password



```

* 使用[Power BI连接Lakehouse](PowerBI.md)

^
