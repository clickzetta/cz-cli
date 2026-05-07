# 数据库元数据视图

在本节中，我们将介绍各种数据库元数据视图，以便您更好地了解和查询您的数据。这些视图提供了有关数据库、表、列、视图、用户、角色和作业历史等详细信息。通过这些视图，您可以轻松地管理和监控您的数据。

## SCHEMAS 视图

SCHEMAS 视图提供了有关数据库（SCHEMA）的详细信息，包括 WORKSPACE 名称、SCHEMA 名称、创建者、类型等。

**字段详细信息**

| COLUMN NAME | DATA TYPE | 描述 |
| --- | --- | --- |
| CATALOG\_NAME | STRING | 当前 WORKSPACE 的名称 |
| SCHEMA\_NAME | STRING | 数据库（SCHEMA）的名字 |
| SCHEMA\_CREATOR | STRING | 数据库（SCHEMA）所有者的账号名称 |
| TYPE | STRING | 枚举值：EXTERNAL（外部）、INTERNAL（内部） |
| COMMENT | STRING | 创建数据库时的注释信息 |
| CREATE\_TIME | TIMESTAMP | 数据库创建时间 |
| LAST\_MODIFY\_TIME | TIMESTAMP | 数据库修改时间 |
| PROPERTIES | MAP | 创建时指定的 PROPERTIES，保留字段 |

## TABLES 视图

TABLES 视图展示了当前 WORKSPACE 下的每个表的详细信息。

**字段详细信息**

| COLUMN NAME | DATA TYPE | 描述 |
| --- | --- | --- |
| TABLE\_CATALOG | STRING | 当前 WORKSPACE 的名称 |
| TABLE\_SCHEMA | STRING | 当前 TABLE 所属的 SCHEMA |
| TABLE\_NAME | STRING | 表名字 |
| TABLE\_TYPE | STRING | 枚举值：EXTERNAL（外部表）、VIEW（视图）、MATERIALIZED VIEW（物化视图）、BASE TABLE（标准表）、SNAPSHOT（快照表） |
| ROW\_COUNT | BIGINT | 表中的条数（对于 VIEW 显示为 NULL，MATERIALIZED VIEW 显示对应条数） |
| BYTES | BIGINT | 表的大小（对于 VIEW 显示为 NULL，MATERIALIZED VIEW 显示对应大小） |
| CREATE\_TIME | TIMESTAMP | 表创建时间 |
| LAST\_MODIFY\_TIME | TIMESTAMP | 表修改时间 |
| TABLE\_CREATOR | STRING | 表所有者的账号名称 |
| IS\_PARTITIONED | BOOLEAN | 是否是分区表（对于 VIEW 显示为 NULL） |
| IS\_CLUSTERED | BOOLEAN | 是否是分桶表（对于 VIEW 显示为 NULL） |
| COMMENT | STRING | 表注释信息 |
| DATA\_LIFECYCLE | BIGINT | 生命周期（单位为天） |
| PROPERTIES | MAP | 创建时指定的 PROPERTIES，保留字段 |


## COLUMNS 视图

COLUMNS 视图展示了表中每个字段的详细信息。

**字段详细信息**

| COLUMN NAME | DATA TYPE | 描述 |
| --- | --- | --- |
| TABLE\_CATALOG | STRING | 当前 WORKSPACE 的名称 |
| TABLE\_SCHEMA | STRING | 当前 TABLE 所属的 SCHEMA |
| TABLE\_NAME | STRING | 表名字 |
| COLUMN\_NAME | STRING | 字段的名字 |
| COLUMN\_DEFAULT | STRING | 字段默认值 |
| IS\_NULLABLE | BOOLEAN | 是否可以为 NULL |
| DATA\_TYPE | STRING | 字段类型 |
| CREATE\_TIME | TIMESTAMP\_LTZ | 表的创建时间 |
| IS\_CLUSTERING\_COLUMN | BOOLEAN | 是否是 CLUSTER 字段 |
| IS\_PRIMARY\_KEY | BOOLEAN | 是否是主键 |
| COMMENT | STRING | 字段的注释信息 |


## VIEWS 视图

VIEWS 视图展示了当前 WORKSPACE 下的所有视图及其详细信息。

**字段详细信息**

| COLUMN NAME        | DATA TYPE | DESCRIPTION     |
| ------------------ | --------- | --------------- |
| TABLE\_CATALOG     | STRING    | 当前WORKSPACE的名称  |
| TABLE\_SCHEMA      | STRING    | 当前VIEW所属的SCHEMA |
| TABLE\_NAME        | STRING    | 视图名字            |
| TABLE\_CREATOR     | STRING    | 视图所有者的账号名称      |
| VIEW\_DEFINITION   | STRING    | 创建视图的语句         |
| CREATE\_TIME       | TIMESTAMP | 视图创建时间          |
| LAST\_MODIFY\_TIME | TIMESTAMP | 视图修改时间          |
| COMMENT            | STRING    | 视图的注释信息         |

## USERS 视图

USERS 视图展示了当前 WORKSPACE 下的所有用户信息。每个用户显示一行。

| COLUMN NAME    | DATA TYPE | DESCRIPTION           |
| -------------- | --------- | --------------------- |
| WORKSPACE\_NAME | STRING    | 当前空间的名字               |
| USER\_NAME     | STRING    | 用户名称                  |
| ROLE\_NAME     | STRING    | 当前用户拥有的角色，多个角色使用逗号分隔  |
| CREATE\_TIME   | TIMESTAMP | 用户加入时间                |
| EMAIL          | STRING    | 用户邮箱                  |
| TELEPHONE       | STRING    | 用户电话                  |
| COMMENT        | STRING    | 描述用户信息                |
| PROPERTIES     | MAP       | 创建时指定的PROPERTIES，保留字段 |

## ROLES 视图

| COLUMN NAME    | DATA TYPE | DESCRIPTION            |
| -------------- | --------- | ---------------------- |
| WORKSPACE\_NAME | STRING    | 当前空间的名字                |
| ROLE\_NAME     | STRING    | 空间下的所有角色               |
| USER\_NAMES    | STRING    | 被授予该角色的用户名称,多个用户使用逗号分开 |
| CREATE\_TIME   | TIMESTAMP | 视图创建时间                 |
| COMMENT        | STRING    | 描述角色信息                 |
| PROPERTIES     | MAP       | 创建时指定的PROPERTIES，保留字段  |

## JOB_HISTORY 视图
| COLUMN NAME      | DATA TYPE | DESCRIPTION                                     |
| ---------------- | --------- | ----------------------------------------------- |
| WORKSPACE\_NAME  | STRING    | 运行JOB所在的空间                                      |
| JOB\_ID          | STRING    | 作业ID                                            |
| JOB\_NAME        | STRING    | 作业名称                                            |
| JOB\_CREATOR     | STRING    | 运行作业的用户                                         |
| STATUS           | STRING    | SCHEDULE, PROCESS, SUCCEEDED, FAILED, CANCELLED |
| CRU              | DECIMAL   | 任务消耗的计算资源                                       |
| ERROR\_MESSAGE   | STRING    | 如果运行出错会有此信息                                     |
| JOB\_TYPE        | STRING    | 作业类型 COPY SQL DATALAKE（文件操作命令）                  |
| JOB\_TEXT        | STRING    | 执行JOB的语句                                        |
| QUERY\_TAG       | STRING    | 用户设置的TAG，用于标识QUERY                              |
| START\_TIME      | TIMESTAMP | JOB运行开始时间                                       |
| END\_TIME        | TIMESTAMP | JOB运行结束时间                                       |
| EXECUTION\_TIME  | DOUBLE    | 执行时间，单位为秒，精确到毫秒                                 |
| INPUT\_BYTES     | BIGINT    | 实际扫描的数据量。                                       |
| OUTPUT\_BYTES    | BIGINT    | 输出字节数。                                          |
| INPUT\_OBJECTS   | STRING    | 输入的表名                                           |
| OUTPUT\_OBJECTS  | STRING    | 输出的表名                                           |
| CLIENT\_INFO     | STRING    | 客户端信息，来自于JDBC、客户端、WEB页面                         |
| VIRTUAL\_CLUSTER | STRING    | 使用的计算资源                                         |
| ROW\_PRODUCED    | BIGINT    | 处理的总记录数，输入的数据                                   |
| ROW\_INSERTED    | BIGINT    | 如果是插入行为应该有值                                     |
| ROW\_UPDATED     | BIGINT    | 如果是更新行为应该有值                                     |
| ROW\_DELETED     | BIGINT    | 如果是删除行为应该有值                                     |
| JOB\_CONFIG      | STRING    | 提交作业时设置的参数信息                                    |
| CACHE\_HIT       | BIGINT    | 从缓存中读取的数据                                       |
| JOB\_PRIORITY    | STRING    | 作业优先级                                           |
| INPUT\_TABLES    | STRING    | 输入的表名                                           |
| OUTPUT\_TABLES   | STRING    | 输出的表名                                           |

## 物化视图刷新历史

| COLUMN\_NAME             | DATA\_TYPE   | DESCRIPTION                    |
| ------------------------ | ------------ | ------------------------------ |
| WORKSPACE\_NAME          | STIRNG       | 项目空间名字                         |
| SCHEMA\_NAME             | STRING       | SCHEMA名字                       |
| MATERIALIZED\_VIEW\_NAME | STRING       | 物化视图名字                         |
| CRU                    | DECIMAL      | 刷新物化视图使用的计费                    |
| VIRTUAL\_CLUSTER\_NAME   | STRING       | 使用的虚拟集群名称，自动刷新任务会有此信息               |
| STATUS                   | STRING       | PENDING\RUNNING\FINISHED\FAILED |
| SCHEDULED\_START\_TIME   | TIMESTAMP_LTZ | 计划刷新时间                         |
| START\_TIME              | TIMESTAMP_LTZ | 物化视图开始时间                       |
| END\_TIME                | TIMESTAMP_LTZ | 物化视图结束时间                       |
| ERROR\_CODE              | STRING       |                                |
| ERROR\_MESSAGE           | STRING       | 刷新失败的信息，如果失败则会在这里有             |

## AUTOMV_REFRESH_HISTORY 视图
| COLUMN\_NAME               | DATA\_TYPE   | DESCRIPTION                                                             |
| -------------------------- | ------------ | ----------------------------------------------------------------------- |
| WORKSPACE_NAME            | STRING       | 项目空间名字                                                               |
| SCHEMA_NAME               | STRING       | SCHEMA名字,AUTOMV所在的SCHEMA                                                |
| MATERIALIZED_VIEW\_NAME   | STRING       | 物化视图名字                                                                  |
| CRU                        | DECIMAL      | 刷新物化视图使用的计费                                                             |
| STATUS                     | STRING       |  PROCESSING：正在刷新。 SUCCEEDED：刷新成功完成。 FAILED：执行期间刷新失败。 CANCELLED：刷新在执行前被取消。  |
| MV\_PROCESS\_TYPE          | STRING       | BUILD：构建MV。REFRESH：刷新                                                   |
| START\_TIME                | TIMESTAMP_LTZ | 物化视图开始时间                                                                |
| END\_TIME                  | TIMESTAMP_LTZ | 物化视图结束时间                                                                |
| BUILD\_FROM\_WORKSPACE     | STRING       | 构建MV对应的源表空间                                                             |
| JOB_ID | STRING       | 构建 MV 的作业 ID                                                           |
| ERROR\_MESSAGE             | STRING       | 刷新失败的信息，如果失败则会在这里有                                                      |

## VOLUMES 视图


| column_name       | data\_type          | description                                           |
| ------------------ | ------------------- | ----------------------------------------------------- |
| VOLUME\_CATALOG    | STRING              | 所属 Workspace 名称                                       |
| VOLUME\_SCHEMA     | STRING              | 所属 Schema 名称                                          |
| VOLUME\_NAME       | STRING              | Volume 名称                                             |
| VOLUME\_URL        | STRING              | Volume 绑定的URL                                         |
| VOLUME\_REGION     | STRING              | Volume 所属区域                                           |
| VOLUME\_TYPE       | STRING              | Volume 类型（INTERNAL 指创建 Volume 时不用指定第三方云厂商地址，或者 EXTERNAL） |
| VOLUME\_CREATOR    | STRING              | Volume 的 owner                                        |
| CONNECTION\_NAME   | STRING              | 引用的connection名称                                       |
| COMMENT            | STRING              | 注释                                                    |
| PROPERTIES         | map\<string,string> |                                                       |
| CREATE\_TIME       | TIMESTAMP           | 创建时间                                                  |
| LAST\_MODIFY\_TIME | TIMESTAMP           | 修改时间                                                  |

## CONNECTIONS 视图


| COLUMN_NAME       | DATA_TYPE           | DESCRIPTION                                                                   |
| ------------------ | ------------------- | ----------------------------------------------------------------------------- |
| WORKSPACE\_NAME    | STRING              | 对象所在的空间                                                                       |
| CONNECTION\_NAME   | STRING              | 连接对象名称                                                                   |
| CONNECTION\_KIND   | STRING              | 枚举值支持的connection种类，STORAGE CONNECTION、 API CONNECTION                         |
| TYPE               | STRING              | 指定连接数据源的类型 storage connection支持 FILE\_SYSTEM api connection支持 CLOUD\_FUNCTION |
| PROVIDER           | STRING              | TYPE 为 FILE_SYSTEM 时，PROVIDER 为 OSS / COS；TYPE 为 CLOUD_FUNCTION 时，PROVIDER 为 aliyun / tencent   |
| REGION             | STRING              | connection 连接的 region，比如 ap-shanghai / cn-beijing                              |
| SOURCE\_CREATOR    | STRING              | 创建者                                                                           |
| CREATE\_TIME       | TIMESTAMP           | 创建时间                                                                          |
| LAST\_MODIFY\_TIME | TIMESTAMP           | 上次修改时间                                                                        |
| COMMENT            | STRING              | 注释信息                                                                          |
| PROPERTIES         | map\<string,string> |                                                                               |

