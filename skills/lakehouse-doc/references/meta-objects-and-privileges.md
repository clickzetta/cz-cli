# 元数据对象及权限（Privileges）

## 权限定义

访问控制权限的授予决定了用户可以对特定对象执行指定操作。对于云器Lakehouse中的每个元数据对象，都有一组可以授予的权限。云器Lakehouse中的所有元数据对象及其拥有的权限点，详见 权限点 文档。

元数据对象有三种表达方式：

1）以对象类型加对象名称，表达已被创建的对象。例如：table mytable（名称为mytable的表） 或 vcluster myvcluster（名称为myvcluster的计算集群）；

2）以关键字 ALL 加对象类别，表达现有和未来所有该类型的对象。例如：ALL tables in schema my\_schema （名称为my\_schema的schema下的所有table类型对象）；

3）以关键字ALL 加关键在 OBJECTS表达现有和未来的所有类型的所有对象，例如：ALL OBJECTS in workspace my\_workspace（名称为my\_workspace的工作空间下所有的对象）。

权限点有两种表达方式：

1）以具体权限点表达，例如：select，read metadata，update 等；

2）以关键字 ALL 加关键字 PRIVILEGES，表达所有权限点，例如：ALL PRIVILEGES on table mytable（mytable表的所有权限点）。

在使用SQL语句进行权限管理时，使用 GRANT <权限点> 和 REVOKE <权限点> 命令。在 GRANT <权限点> 语句末尾加上 WITH GRANT OPTION，表示在授予该权限点的同时，将允许被授予者将该权限点再授予其他角色或用户。

## 元数据对象

Lakehouse中的元数据对象及其父级对象如下表所示：

| **元数据对象**         | **父级对象**  |
| ----------------- | --------- |
| workspace         | instance  |
| share             | instance  |
| network policy    | instance  |
| schema            | workspace |
| virtual cluster   | workspace |
| connection        | workspace |
| table             | schema    |
| view              | schema    |
| materialized view | schema    |
| dynamic table     | schema    |
| table stream      | schema    |
| volume            | schema    |
| index             | schema    |
| function          | schema    |
| job               | schema    |

元数据对象均可以通过SQL进行授权。工作空间内的对象可在Web端，在“管理”-“安全”-“权限”中操作授权。

### ALL 对象

ALL 对象是一种特殊的元数据对象，表达一类对象下**当前**和**未来**的所有个体。例如：all tables表达当前和未来的所有table；all vclusters表达当前和未来的所有计算集群。

ALL 对象在使用时，需要和关键字“IN”一起使用，以明确 ALL 对象描述的范围，关键字“IN”之后跟随的是 ALL 对象的父级对象。例如：all tables in schema my\_schema; all vclusters in workspace my\_workspace。

ALL 对象的一种特殊用法是用于指代某父级对象下的所有自级对象，例如：all objects in schema my\_schema，表达my\_schema下的所有类型对象，包括table、view、functions等。

注意：尽管ALL对象可以提升授权操作的效率，但请谨慎使用all objects的方式授权。仅在确认all objects指代的范围符合授权预期时，再使用all objects进行指代，避免授权范围超出预期。

## 业务对象

除元数据对象外，在数据开发、数据治理过程中，产生了业务对象，如下表所示：

| **业务对象**           | **业务类别**              |
| ------------------ | --------------------- |
| 脚本（Script）         | 数据开发（development）     |
| 任务和实例（Task）        | 监控规则（monitor rules）   |
|                    | 通知策略（announce policy） |
| 数据质量（Data Quality） | 质量规则（DQC rule）        |

业务对象不可通过SQL进行授权。用户通过被授予包含业务对象权限的预置角色来获取相关权限。暂不支持对业务对象的细粒度授权。

## 权限点

### 服务实例（Instance） 权限点

| **权限点**               | **用途** | **说明**                                     |
| --------------------- | ------ | ------------------------------------------ |
| create workspace      | 创建工作空间 | 默认授予实例管理员（instance\_admin角色），不支持授予其他角色或用户。 |
| create network policy | 创建网络策略 | 默认授予实例管理员（instance\_admin角色），不支持授予其他角色或用户。 |
| drop workspace        | 删除工作空间 | 默认授予实例管理员（instance\_admin角色），不支持授予其他角色或用户。 |

### 工作空间（workspace）权限点

| **限点**            | **用途**                    | **说明**                                            |
| ----------------- | ------------------------- | ------------------------------------------------- |
| alter workspace   | 修改工作空间                    | 默认授予该空间的空间管理员（workspace\_admin）角色，不支持授予其他角色或用户。   |
| create connection | 创建connection对象            |                                                   |
| create vcluster   | 创建计算集群（virtual cluster）对象 |                                                   |
| create schema     | 创建schema对象                |                                                   |
| create user       | 将实例用户加入工作空间               | 默认授予该工作空间的空间管理员（workspace\_admin）角色，不支持授予其他角色或用户。 |
| create role       | 创建空间级别角色                  | 默认授予该工作空间的空间管理员（workspace\_admin）角色，不支持授予其他角色或用户。 |

授权示例：

```SQL
grant alter workspace on workspace meter_n_bill to user demo_user1;
grant create vcluster on workspace meter_n_bill to user demo_user1;
grant create schema on workspace meter_n_bill to user demo_user1;
grant create connection on workspace meter_n_bill to user demo_user1;


```

### Schema 权限点

| **权限点**                 | **用途**                                     | **说明** |
| ------------------------ | ------------------------------------------ | ------ |
| alter schema             | 修改schema                                   |        |
| drop schema              | 删除schema                                   |        |
| read metadata            | 查询schema的元数据，用于DESC SCHEMA 和 SHOW SCHEMAS命令 |        |
| create table             | 创建table                                    |        |
| create view              | 创建view                                     |        |
| create materialized view | 创建materialized view                        |        |
| create dynamic table     | 创建dynamic table                            |        |
| create index             | 创建index                                    |        |
| create function          | 创建function                                 |        |
| create table stream       | 创建table stream                             |        |
| all privileges           | 包含schema对象的所有权限                            |        |

授权示例：

```SQL
grant alter schema on schema public to user demo_user1;
grant drop schema on schema public to user demo_user1;
grant read metadata on schema public to user demo_user1;


```

### 计算集群（virtual cluster）权限点

| **权限点**        | **用途**                                      | **说明** |
| -------------- | ------------------------------------------- | ------ |
| alter vcluster | 修改计算集群属性或开关机状态                              |        |
| drop vcluster  | 删除计算集群                                      |        |
| read metadata  | 查询计算集群的元数据，用于show vclusters或desc vcluster命令 |        |
| use vcluster   | 使用计算集群                                      |        |
| all privileges | 包含vcluster对象的所有权限                           |        |

授权示例：

```SQL
grant alter vcluster on vcluster default to user demo_user1;
grant drop vcluster on vcluster default to user demo_user1;
grant read metadata on vcluster default to user demo_user1;
grant use vcluster on vcluster default to user demo_user1;
```

### Connection 权限点

| **权限点**          | **用途**              | **说明** |
| ---------------- | ------------------- | ------ |
| read metadata    | 用于查询connection的元数据  |        |
| alter connection | 用于修改connection属性    |        |
| drop connection  | 用于删除指定connection    |        |
| all privileges   | 包含connection对象的所有权限 |        |

### Table 权限点

| **权限点**        | **用途**                                   | **说明** |
| -------------- | ---------------------------------------- | ------ |
| read metadata  | 查询table的元数据。用于执行SHOW TABLES或DESC TABLE语句 |        |
| select         | 用于查询table中的数据                            |        |
| alter table    | 用于修改table的属性或定义                          |        |
| drop table     | 用于删除指定table对象                            |        |
| insert table   | 用于向table中写入数据                            |        |
| delete table   | 用于删除table中的数据                            |        |
| restore table  | 用于恢复table中的数据到指定版本                       |        |
| truncate table | 用于清空table                                |        |
| update table   | 更新table中的数据                              |        |
| all privileges | 包含table对象的所有权限                           |        |

说明：

1）merge into table操作：需要同时具备table的insert、update和delete权限；

2）insert overwrite操作：需要同时具备table的insert 和delete权限；

3）copy into table操作：需要具备table的insert权限。

### View 权限点

| **权限点**        | **用途**                                 | **说明** |
| -------------- | -------------------------------------- | ------ |
| read metadata  | 查询view的元数据。用于执行SHOW VIEWS或DESC VIEW语句 |        |
| select         | 用于查询view中的数据                           |        |
| alter view     | 用于修改view对象的属性或定义                       |        |
| drop view      | 用于删除指定view对象                           |        |
| all privileges | 包含view对象的所有权限                          |        |

### Dynamic Table 权限点

| **权限点**               | **用途**                                                           | **说明** |
| --------------------- | ---------------------------------------------------------------- | ------ |
| read metadata         | 查询dynamic table的元数据。用于执行SHOW DYNAMIC TABLES或DESC DYNAMIC TABLE语句 |        |
| select                | 用于查询dynamic table中的数据                                            |        |
| alter dynamic table   | 用于修改dynamic table的属性或定义                                          |        |
| drop dynamic table    | 用于删除指定的dynamic table                                             |        |
| restore dynamic table | 用于恢复dynamic table到指定版本                                           |        |
| all privileges        | 包含dynamic table对象的所有权限                                           |        |

### Materialized view 权限点

| **权限点**                    | **用途**                                                                       | **说明** |
| -------------------------- | ---------------------------------------------------------------------------- | ------ |
| read metadata              | 查询materialized view的元数据。用于执行SHOW MATERIALIZED VIEWS或DESC MATERIALIZED VIEW语句 |        |
| select                     | 用于查询materialized view中的数据                                                    |        |
| alter materialized view    | 用于修改materialized view的属性和定义                                                  |        |
| delete materialized view   | 用于删除materialized view中的数据                                                    |        |
| drop materialized view     | 用于删除指定materialized view                                                      |        |
| update materialized view   | 用于刷新（refresh）materialized view对象                                             |        |
| truncate materialized view | 用于清空指定materialized view中的数据                                                  |        |
| all privileges             | 包含materialized view中的所有权限                                                    |        |

### Function 权限点

| **权限点**        | **用途**                                            | **说明** |
| -------------- | ------------------------------------------------- | ------ |
| read metadata  | 查询function的元数据。用于执行SHOW FUNCTIONS或DESC FUNCTION语句 |        |
| alter function | 用于修改指定function                                    |        |
| use function   | 可使用指定function                                     |        |
| drop function  | 用于删除指定function                                    |        |
| all privileges | 包含function对象的所有权限                                 |        |

### Volume 权限点

| **权限点**        | **用途**                                                              | **说明** |
| -------------- | ------------------------------------------------------------------- | ------ |
| read metadata  | 查看Volume对象元信息权限。                                                    |        |
| read volume    | 读取Volume对象下文件及目录的权限。当需要查看Volume下文件列表、SQL读取Volume文件以及通过GET命令下载文件时需要。 |        |
| write volume   | 写入数据到Volume的权限。当需要通过PUT命令上传文件，通过REMOVE命令删除文件时需要。                    |        |
| alter volume   | ALTER VOLUME命令需要的权限。如：ALTER VOLUME  REFRESH 刷新Volume下的文件元数据信息。      |        |
| all privileges | 包含volume对象的所有权限                                                     |        |

### Table Stream 权限点

| **权限点**            | **用途**                 | **说明** |
| ------------------ | ---------------------- | ------ |
| read metadata      | 查看table stream对象的元数据   |        |
| alter table stream | 修改table stream对象的属性或定义 |        |
| select             | 查询table stream中的数据     |        |
| drop table stream  | 删除指定table stream对象     |        |
| all privileges     | 包含table stream对象的所有权限  |        |

### Index 权限点

| **权限点**        | **用途**         | **说明** |
| -------------- | -------------- | ------ |
| read metadata  | 查看index对象的元数据  |        |
| drop index     | 用于删除指定index    |        |
| all privileges | 包含index对象的所有权限 |        |

### Job 权限点

| **权限点**        | **用途**       | **说明**                                           |
| -------------- | ------------ | ------------------------------------------------ |
| read metadata  | 查看job对象的元数据  | 不可用于授权。空间管理员角色（workspace\_admin)以及job执行者默认拥有此权限。 |
| terminate job  | 用于结束指定job    | 不可用于授权。job执行者默认拥有此权限。                            |
| all privileges | 包含job对象的所有权限 | 不可用于授权。job执行者默认拥有此权限。                            |

### ALL 权限点

ALL 权限点是各类元数据对象上均存在的一个权限点，表达该对象的所有权限点。ALL权限点是一个**独立**的权限点，与其他权限点并非指代关系。因此授予ALL权限点不会覆盖授予其他权限点，解除ALL权限点也不会解除其他权限点。

例如：对user my\_user 先后授予了example\_table的select和ALL权限点。则此时my\_user用户由于被授予了ALL权限点，可以对example\_table执行所有操作；在查询my\_user用户对example\_table的权限时，显示同时拥有的select和all权限点的授权。当对my\_user用户解除ALL权限点的授权时，my\_user用户仍具备对example\_table进行select操作的权限。

使用ALL权限点可以快速完成对一个对象所有权限的授予，例如：

```
Grant all privileges on table example_table to user my_user;
```

^
