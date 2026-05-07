#### WORKSPACES视图

记录了WORKSPACE的详细信息

| COLUMN NAME            | DATA TYPE           | DESCRIPTION                         |
| ---------------------- | ------------------- | ----------------------------------- |
| WORKSPACE\_ID          | STRING              | 工作空间ID                              |
| WORKSPACE\_NAME        | STRING              | 工作空间的名字                             |
| WORKSPACE\_CREATOR     | STRING              | 工作空间的所有者                            |
| WORKSPACE\_CREATOR\_ID | STRING              | 工作空间的所有者的帐号ID                       |
| WORKSPACE\_STORAGE     | BIGINT              | 工作空间存储情况，外部表和外部数据湖不计入，统计内部数据湖和表存储情况 |
| CREATE\_TIME           | TIMESTAMP           | 工作空间创建时间                            |
| LAST\_MODIFY\_TIME     | TIMESTAMP           | 工作空间修改时间                             |
| COMMENT                | STRING              | 工作空间注释信息                            |
| DELETE\_TIME           | TIMESTAMP           | 工作空间删除时间                            |
| PROPERTIES             | MAP\<STRING,STRING> | 设置的PROPERTIES都会记录在此参数中              |

#### SCHEMAS 视图

记录了 SCHEMA 的详细信息

**字段详细信息**

| COLUMN NAME         | DATA TYPE           | DESCRIPTION            |
| ------------------- | ------------------- | ---------------------- |
| CATALOG\_NAME       | STRING              | 当前WORKSPACE的名字         |
| SCHEMA\_ID          | STRING              | SCHEMA的ID                  |
| SCHEMA\_NAME        | STRING              | SCHEMA的名字                 |
| TYPE                | STRING              | 枚举值EXTERNAL 、MANAGED   |
| SCHEMA\_CREATOR     | STRING              | 数据库的所有者的帐号名字           |
| SCHEMA\_CREATOR\_ID | STRING              | 数据库的所有者的帐号ID           |
| CREATE\_TIME        | TIMESTAMP           | 数据库创建时间                |
| LAST\_MODIFY\_TIME  | TIMESTAMP           | 数据库修改时间                |
| COMMENT             | STRING              | 创建数据库时注释信息             |
| DELETE\_TIME        | TIMESTAMP           | 数据库删除时间                |
| PROPERTIES          | MAP\<STRING,STRING> | 设置的PROPERTIES都会记录在此参数中 |


#### TABLES 视图

当前 WORKSPACE 下，每个表显示一行


| COLUMN NAME        | DATA TYPE           | DESCRIPTION                                                                                                                                                                                                                                                                                                                        |
| ------ | --- | ------------ |
| TABLE\_CATALOG     | STRING              | 当前WORKSPACE的名称                                                                                                                                                                                                                                                                                                                     |
| TABLE\_CATALOG\_ID | STRING              | WORKSPACE的ID                                                                                                                                                                                                                                                                                                                       |
| TABLE\_SCHEMA      | STRING              | 当前TABLE所属的SCHEMA                                                                                                                                                                                                                                                                                                                   |
| TABLE\_SCHEMA\_ID  | STRING              | 表对应数据库的ID                                                                                                                                                                                                                                                                                                                          |
| TABLE\_NAME        | STRING              | 表名字                                                                                                                                                                                                                                                                                                                                |
| TABLE\_ID          | STRING              | 表ID                                                                                                                                                                                                                                                                                                                                |
| TABLE\_CREATOR     | STRING              | 表的所有者                                                                                                                                                                                                                                                                                                                              |
| TABLE\_CREATOR\_ID | STRING              | 表创建者ID                                                                                                                                                                                                                                                                                                                             |
| TABLE\_TYPE        | STRING              | EXTERNAL TABLE：外部表 VIRTUAL\_VIEW：视图 MATERIALIIZED VIEW：物化视图 MANAGED\_TABLE：标准表                                                                                                                                                                                                                                                     |
| ROW\_COUNT         | BIGINT              | 条数,此处可能显示的为估计值，，显示估计值统计的情况包含&#XA;1.通过实时写入的数据包含PRIMARY KEY表，由于数据一直在变动存在MEMORY TABLE的数据无法准确统计&#XA;2.通常大部分UPDATE和DELETE操作是可以统计，但是实时写过的分区表，然后做UPDATE/DELETE 可能统计不准确,因为在执行删除提交时，请求没有携带文件删除多少条信息暂时无法记录&#XA;3.删除分区INSERT OVERWRITE PARTITION和TRUNCATE PARTITION，请求没有携带文件删除多少条信息可能统计不准确 |
| BYTES              | BIGINT              | 占用空间大小, 条数,此处可能显示的为估计值，，显示估计值统计的情况包含&#XA;1.通过实时写入的数据包含PRIMARY KEY表，由于数据一直在变动存在MEMORY TABLE的数据无法准确统计&#XA;2.通常大部分UPDATE和DELETE操作是可以统计，但是实时写过的分区表，然后做UPDATE/DELETE 可能统计不准确,因为在执行删除提交时，请求没有携带文件删除文件信息暂时无法记录&#XA;3.删除分区INSERT OVERWRITE PARTITION和TRUNCATE PARTITION，请求没有携带文件删除大小信息可能统计不准确                                                                                                                                                                                                                                                         |
| CREATE\_TIME       | TIMESTAMP           | 表创建时间                                                                                                                                                                                                                                                                                                                              |
| LAST\_MODIFY\_TIME | TIMESTAMP           | 表修改时间                                                                                                                                                                                                                                                                                                                              |
| DATA\_LIFECYCLE    | BIGINT              | 生命周期                                                                                                                                                                                                                                                                                                                               |
| IS\_PARTITIONED    | BOOLEAN             | 是否是分区表                                                                                                                                                                                                                                                                                                                             |
| IS\_CLUSTERED      | BOOLEAN             | 是否是分桶表                                                                                                                                                                                                                                                                                                                             |
| COMMENT            | STRING              | 表注释信息                                                                                                                                                                                                                                                                                                                              |
| DELETE\_TIME       | TIMESTAMP           | 删除时间，没有删除为NULL                                                                                                                                                                                                                                                                                                                     |
| DATA\_LIFECYCLE    | INT                 | 设置的生命周期，如果未设置显示为NULL代表永久，设置则会显示相应时间                                                                                                                                                                                                                                                                                                |
| PROPERTIES         | MAP\<STRING,STRING> | 设置的PROPERTIES都会记录在此参数中                                                                                                                                                                                                                                                                                                             |


#### COLUMNS 视图

查询结果包含表中每个字段为一行


| COLUMN NAME              | DATA TYPE | DESCRIPTION      |
| ------------------------ | --------- | ---------------- |
| TABLE\_CATALOG           | STRING    | 当前WORKSPACE的名称   |
| TABLE\_CATALOG\_ID       | STRING    | WORKSPACE的ID     |
| TABLE\_SCHEMA            | STRING    | 当前TABLE所属的SCHEMA |
| TABLE\_SCHEMA\_ID        | STRING    | 表对应数据库的ID        |
| TABLE\_NAME              | STRING    | 表名字              |
| TABLE\_ID                | STRING    | 表ID              |
| COLUMN\_NAME             | STRING    | 字段的名字            |
| COLUMN\_ID               | STRING    | 字段ID             |
| COLUMN\_DEFAULT          | STRING    | 字段默认值,当前保留值      |
| IS\_NULLABLE             | BOOLEAN   | 是否可以为NULL        |
| DATA\_TYPE               | STRING    | 字段类型             |
| IS\_PARTITIONING\_COLUMN | BOOLEAN  | 是否是分区字段          |
| IS\_CLUSTERING\_COLUMN   | BOOLEAN  | 是否是 CLUSTER 字段      |
| IS\_PRIMARY\_KEY         | BOOLEAN  | 是否是主键            |
| COMMENT                  | STRING    | 字段的注释信息          |
| DELETE\_TIME             | TIMESTAMP | 删除时间，没有删除为NULL   |


​


#### VIEWS 视图


每个视图显示一行，包含当前 INSTANCE 下所有的视图


| COLUMN NAME        | DATA TYPE | DESCRIPTION     |
| ------------------ | --------- | --------------- |
| TABLE\_CATALOG     | STRING    | 当前WORKSPACE的名称  |
| TABLE\_CATALOG\_ID | STRING    | WORKSPACE的ID    |
| TABLE\_SCHEMA      | STRING    | 当前VIEW所属的SCHEMA |
| TABLE\_SCHEMA\_ID  | STRING    | 视图对应数据库的ID      |
| TABLE\_NAME        | STRING    | 视图名字            |
| TABLE\_ID          | STRING    | 视图ID            |
| TABLE\_CREATOR     | STRING    | 视图所有者的帐号名字      |
| TABLE\_CREATOR\_ID | STRING    | 视图所有者的帐号ID      |
| VIEW\_DEFINITION   | STRING    | 创建视图的语句         |
| CREATE\_TIME       | TIMESTAMP | 视图创建时间          |
| LAST\_MODIFY\_TIME | TIMESTAMP | 视图修改时间          |
| COMMENT            | STRING    | 视图的注释信息         |
| DELETE\_TIME       | TIMESTAMP | 删除时间，没有删除为NULL  |

#### USERS视图


每个用户和空间显示一行，包含当前ACCOUNT所有的用户


| COLUMN NAME          | DATA TYPE           | DESCRIPTION                        |
| -------------------- | ------------------- | ---------------------------------- |
| WORKSPACE\_NAME       | STRING              | 用户所在的工作空间                          |
| WORKSPACE\_ID         | STRING              | 用户所在的空间ID                          |
| USER\_ID             | STRING              | 系统根据用户生成的用户ID,                     |
| USER\_NAME           | STRING              | 用户名称，使用WORKSPACE NAME和USER NAME 拼接 |
| ROLE\_NAME           | STRING              | 当前用户拥有的角色，多个角色使用逗号分隔               |
| ADD\_TIME            | TIEMSTAMP           | 用户创建时间                             |
| EMAIL                | STRING              | 用户邮箱                               |
| TELEPHONE             | STRING              | 用户电话                               |
| LAST\_SUCCESS\_LOGIN | TIMESTAMP           | 上次登录时间                             |
| COMMENT              | STRING              | 描述用户信息                             |
| DELETE\_TIME         | TIMESTAMP           | 删除时间，没有删除为NULL                     |
| PROPERTIES           | MAP\<STRING,STRING> | 设置的PROPERTIES都会记录在此参数中             |

#### ROLES视图

每个角色和空间显示一行，包含当前ACCOUNT所有的角色

| COLUMN NAME    | DATA TYPE | DESCRIPTION                         |
| -------------- | --------- | ----------------------------------- |
| WORKSPACE\_NAME | STRING    | 当前空间的名字                             |
| WORKSPACE\_ID   | STRING    | 角色所在的空间ID                           |
| ROLE\_NAME     | STRING    | 角色名称,                               |
| ROLE\_ID       | STRING    | ROLE ID                             |
| USER\_NAME     | STRING    | 被授予该角色的用户名称，多个用户使用逗号分隔符。ROLE对应用户有哪些 |
| USER\_ID       | STRING    | 被授予该角色的用户ID                         |
| COMMENT        | STRING    | 描述用户信息                              |
| DELETE\_TIME   | TIMESTAMP | 删除时间，没有删除为NULL                      |

#### JOB_HISTORY视图

所有空间下的运行信息

| COLUMN NAME          | DATA TYPE     | DESCRIPTION                                                                                                                                                                                                           |
| ------ | --- | ------------ |
| WORKSPACE\_NAME       | STRING        | 运行JOB所在的空间                                                                                                                                                                                                            |
| WORKSPACE\_ID        | STRING        |                                                                                                                                                                                                                       |
| JOB\_ID              | STRING        | 作业ID                                                                                                                                                                                                                  |
| JOB\_NAME            | STRING        | 作业名称                                                                                                                                                                                                                  |
| JOB\_CREATOR\_ID     | STRING        | 运行作业的用户ID                                                                                                                                                                                                             |
| JOB\_CREATOR         | STRING        | 运行作业的用户                                                                                                                                                                                                               |
| STATUS               | STRING        | SETUP RESUMING\_CLUSTER QUEUED RUNNING SUCCESS FAILED CANCELED                                                                                                                                                        |
| CRU                  | DECIMAL(38,5) | 用户消耗的计算资源                                                                                                                                                                                                   |
| ERROR\_MESSAGE       | STRING        | 如果运行出错会有此信息                                                                                                                                                                                                           |
| JOB\_TYPE            | STRING        | 作业类型  SQL                                                                                                                                                                                                             |
| JOB\_TEXT            | STRING        | 执行JOB的语句                                                                                                                                                                                                              |
| START\_TIME          | TIMESTAMP     | JOB运行开始时间                                                                                                                                                                                                             |
| END\_TIME            | TIMESTAMP     | JOB运行结束时间                                                                                                                                                                                                             |
| EXECUTION\_TIME      | DOUBLE        | 执行时间，单位为秒                                                                                                                                                                                                             |
| INPUT\_BYTES         | BIGINT        | 实际扫描的数据量。                                                                                                                                                                                                             |
| CACHE\_HIT           | BIGINT        | 从缓存中读取的数据                                                                                                                                                                                                             |
| OUTPUT\_BYTES        | BIGINT        | 输出字节数。                                                                                                                                                                                                                |
| INPUT\_OBJECTS       | STRING        | 输入的表名格式为\[SCHEMA].\[TABLE]多个以，分隔                                                                                                                                                                                      |
| OUTPUT\_OBJECTS      | STRING        | 输出的表名格式为\[SCHEMA].\[TABLE]                                                                                                                                                                                            |
| CLIENT\_INFO         | STRING        | 客户端信息，来自于JDBC、客户端、WEB页面、JAVA SDK                                                                                                                                                                                      |
| VIRTUAL\_CLUSTER     | STRING        | 使用的计算资源                                                                                                                                                                                                               |
| VIRTUAL\_CLUSTER\_ID | BIGINT        |                                                                                                                                                                                                                       |
| ROWS\_PRODUCED       | BIGINT        | 处理的总记录数，输入的数据                                                                                                                                                                                                         |
| ROWS\_INSERTED       | BIGINT        | 如果是插入行为应该有值                                                                                                                                                                                                           |
| ROWS\_UPDATED        | BIGINT        | 如果是更新行为应该有值                                                                                                                                                                                                           |
| ROWS\_DELETED        | BIGINT        | 如果是删除行为应该有值                                                                                                                                                                                                           |
| JOB\_CONFIG          | STRING        | 提交作业时设置的参数信息                                                                                                                                                                                                          |
| JOB\_PRIORITY        | STRING        | 作业优先级                                                                                                                                                                                                                 |
| INPUT\_TABLES        | STRING        | JSON格式数组 INPUT\_TABLES:{\[{TABLE:WORKSAPCE\_NAME.SCHEMA.TABLENAME1, SIZE:0,RECORD:0,CACHESIZE:0,PARTITIONS:\[]},{TABLE:WORKSAPCE\_NAME.SCHEMA.TABLENAME2 SIZE:0,RECORD:0,CACHESIZE:0,PARTITIONS:\[]}......]}         |
| OUTPUT\_TABLES       | STRING        | 输出的对象名称|
| QUERY\_TAG          | STRING        | 用户可以在客户给JOB打标签                                                                                                                                                                                                        |
| ERROR\_MESSAGE       | STRING        | 错误信息                                                                                                                                                                                                                  |


#### MATERIALIZED VIEW刷新视图(MATERIALIZED\_VIEW\_REFRESH\_HISTORY)

| COLUMN\_NAME             | DATA\_TYPE   | DESCRIPTION                          |
| ------------------------ | ------------ | ------------------------------------ |
| WORKSPACE\_ID            | BIGINT       | 项目空间ID                               |
| WORKSPACE\_NAME          | STIRNG       | 项目空间名字                               |
| SCHEMA\_ID               | BIGINT       | SCHEMA ID                            |
| SCHEMA\_NAME             | STRING       | SCHEMA名字                             |
| MATERIALIZED\_VIEW\_ID   | BIGINT       | 物化视图                               |
| MATERIALIZED\_VIEW\_NAME | STRING       | 物化视图名字                               |
| CREDITS\_USED            | DECIMAL      | 刷新物化视图使用的计费                          |
| VIRTUAL\_CLUSER\_ID      | BIGINT       | 物化视图ID                               |
| VIRTUAL\_CLUSTER         | STRING       | 物化视图名字，自动刷新会有此信息                     |
| STATUS                   | STRING       | PENDING\RUNNING\FINISHED\FAILED       |
| REFRESH\_MODE            | STRING       | 枚举值INCREMETAL FULL\_REFRESH NO\_DATA |
| STATISTICS               | STRING       | 记录增量刷多少条                             |
| SCHEDULE\_START\_TIME    | TIMESTAMP_LTZ | 计划刷新时间                               |
| START\_TIME              | TIMESTAMP_LTZ | 物化视图开始时间                             |
| END\_TIME                | TIMESTAMP_LTZ | 物化视图结束时间                             |
| ERROR\_MESSAGE           | STRING       | 刷新失败的信息，如果失败则会在这里有                   |


#### VOLUMES视图


| column\_name        | data\_type          | description                                           |
| ------------------- | ------------------- | ----------------------------------------------------- |
| VOLUME\_CATALOG     | STRING              | 所属 Workspace 名称                                       |
| VOLUME\_CATALOG\_ID | STRING              | 所属 Workspace 的ID                                      |
| VOLUME\_SCHEMA      | STRING              | 所属 Schema 名称                                          |
| VOLUME\_SCHEMA\_ID  | STRING              | Volume对应数schema的ID                                    |
| VOLUME\_NAME        | STRING              | Volume 名称                                             |
| VOLUME\_ID          | STRING              | Volume的ID                                             |
| VOLUME\_URL         | STRING              | Volume 绑定的URL                                         |
| VOLUME\_REGION      | STRING              | Volume 所属区域                                           |
| VOLUME\_TYPE        | STRING              | Volume 类型(internal指创建volumn时不用指定第三方云厂商地址，或者 external) |
| VOLUME\_CREATOR     | STRING              | Volume 的 owner                                        |
| CONNECTION\_NAME    | STRING              | 引用的connection名称                                       |
| CONNECTION\_ID      | STRING              | 引用的connection的ID                                      |
| PROPERTIES          | map\<string,string> |                                                       |
| COMMENT             | STRING              | 注释                                                    |
| CREATE\_TIME        | TIMESTAMP           | 创建时间                                                  |
| LAST\_MODIFY\_TIME  | TIMESTAMP           | 修改时间                                                  |

#### CONNECTIONS视图


| column_name     | data type           | description                                                                   |
| ---------------- | ------------------- | ----------------------------------------------------------------------------- |
| WORKSPACE\_NAME  | STRING              | 对象所在的空间                                                                       |
| WORKSPACE\_ID    | STRING              |                                                                               |
| CONNECTION\_NAME | STRING              | 连接对象名称                                                                   |
| CONNECTION\_ID   | STRING              |                                                                               |
| CONNECTION\_KIND | STRING              | 枚举值支持的connection种类，STORAGE CONNECTION、 API CONNECTION                         |
| TYPE             | STRING              | 指定连接数据源的类型 storage connection支持 FILE\_SYSTEM api connection支持 CLOUD\_FUNCTION |
| PROVIDER         | STRING              | TYPE 为 FILE\_SYSTEM 时为 OSS / COS TYPE 为 CLOUD\_FUNCTION 时为 aliyun / tencent   |
| REGION           | STRING              | connection 连接的region，比如 ap-shanghai / cn-beijing                              |
| SOURCE\_CREATOR  | STRING              | 创建者                                                                           |
| CREATED\_TIME    | TIMESTAMP           | 创建时间                                                                          |
| COMMENT          | STRING              | 注释信息                                                                          |
| PROPERTIES       | map\<string,string> |                                                                               |







#### OBJECT_PRIVILEGES视图


| Column Name         | Data Type      | Description                                 |
| ------------------- | -------------- | ------------------------------------------- |
| GRANTOR             | TEXT           | 授出权限的USER                                   |
| GRANTEE             | TEXT           | 被授予权限的user\_name 或 role\_name               |
| GRANTED\_TO         | TEXT           | USER/ROLE                                   |
| OBJECT\_CATALOG     | TEXT           | 被授予对象所在的工作空间或catalog名称                      |
| OBJECT\_SCHEMA      | TEXT           | 被授予对象所在的schema，如果对象不在schema下则为空             |
| OBJECT\_NAME        | TEXT           | 被授权的对象名称。直接显示名称，不用workspace.schema.name的方式。 |
| OBJECT\_TYPE        | TEXT           | 被授权的对象的类型                                   |
| SUB\_OBJECT\_TYPE   | TEXT           |                                             |
| PRIVILEGE\_TYPE     | TEXT           | 被授予的具体角色                                    |
| IS\_GRANTABLE       | TEXT           | 授权时是否有 WITH GRANT OPTION                    |
| AUTHORIZATION\_TIME | TIMESTAMP\_LTZ | 权限授予时间                                      |

