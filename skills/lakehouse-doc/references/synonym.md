# 同义词
## 概述

同义词（synonym）是一个数据库对象，类似于给对象起一个别名，具有以下用途：

* 当您需要在schema02中查询schema01的表t，但又不希望复制数据时，可以在schema02中为表t创建一个同义词sy\_t。这样，您就可以直接在schema02中查询sy\_t，而数据将实时与schema01中的表t保持一致。这是一种高效的数据管理策略，既保证了数据的一致性，又避免了不必要的数据重复。
* 提供一个抽象层，保护客户端应用程序免受对基础对象的名称或位置所做的更改的影响。

同义词属于 schema，与 schema 中的其他对象一样，同义词的名称必须在同一 schema 下唯一。支持为以下对象创建同义词：table、table stream、dynamic table、materialized view、volume、function。


## 操作管理
### 创建

```SQL
CREATE  [TABLE|VOLUME|FUNCITON] SYNONYM [schema_name.] synonym_name FOR object COMMENT''
object ::=
workspace_name.schema_name.object_name|schema_name.object_name｜object_name
```

* TABLE|VOLUME|FUNCTION：表示同义词对象类型。

  * **TABLE**：这是默认选项。用于为 table、table stream、materialized view、dynamic table 命名同义词。在这些情况下，“table”关键字是可选的。
  * **VOLUME**：为 volume 命名同义词时，必须明确指定此关键字。如果省略，系统将默认寻找同名的表格对象。
  * **FUNCTION**：为 function 命名同义词时，此关键字是必填项。如果未指定，系统会默认寻找同名的 table 对象。

* synonym\_name:同义词名称，遵循元数据规范

* object：指定基对象的名称，支持workspace\_name.schema\_name\_2.object\_name、schema\_name\_2.name格式如果省略schema则使用当前schema中的对象


### 删除

```SQL
DROP [TABLE|VOLUME|FUNCITON] SYNONYM [ IF EXISTS ] [ schema. ] synonym_name
```

* TABLE|VOLUME|FUNCTION：表示同义词的对象类型。

  * **TABLE**：这是默认选项。用于为 table、table stream、materialized view、dynamic table 命名同义词。在这些情况下，“table”关键字是可选的。
  * **VOLUME**：为 volume 命名同义词时，必须明确指定此关键字。如果省略，系统将默认寻找同名的表格对象。
  * **FUNCTION**：为 function 命名同义词时，此关键字是必填项。如果未指定，系统会默认寻找同名的 table 对象。

* if exists：可选。仅当同义词存在时，才有条件地删除该同义词。

* schema：可选，指定同义词所在的 schema。如果未指定 schema，则使用当前会话的默认 schema。

### 权限

创建同义词需要 `CREATE SYNONYM` 权限。

```SQL
grant create synonym  on schema  scname to user uat_test_01;
```

删除同义词需要 `DROP` 权限。

```SQL
grant drop synonym on all synonyms in schema <schemaname> to user uat_test_01;
grant create synonym  on schema  scname to user uat_test_01;
```

### 同义词查询权限

同义词的权限与基对象的权限相同。授予对同义词的权限等同于授予对应基对象的权限。同样，授予对基对象的权限等同于授予对该对象的所有同义词的权限。如果向用户授予对同义词的权限，则该用户可以在行使该权限的 SQL 语句中使用同义词名称或基对象名称。

### 列出同义词

```SQL
SHOW SYNONYMS [IN {SCHEMA scname | WORKSPACE wbname}] [WHRERE <expr>]
```

## 使用示例

为 table 创建同义词

```SQL
--创建表
CREATE TABLE `public`.students(
  `name` string,
  `class` string);
--给表创建同义词
CREATE SYNONYM students_sy for `public`.students;
--查询同义词
select * from students_sy;
--删除同义词
drop synonym students_sy;
```

为 table stream 创建同义词，其语法与为 table 创建同义词相同。

```SQL
create  synonym students_stream_synonym for public.students_stream;
--删除同义词
drop synonym students_stream_synonym;
```

为 dynamic table 创建同义词，其语法与为 table 创建同义词相同。

```SQL
create  synonym event_group_minute_sy for public.event_group_minute;
--删除同义词
drop synonym event_group_minute_sy;
```

为 materialized view 创建同义词，其语法与为 table 创建同义词相同。

```SQL
create SYNONYM event_group_mv_sy for event_group_mv;
--删除同义词
drop synonym event_group_mv_sy;
```

为 volume 创建同义词，其中 VOLUME 为必选关键字。如果不指定，则系统会默认寻找同名的表格对象。

```SQL
create volume synonym hz_csv_volume_sy for public.hz_csv_volume;
--删除同义词
drop volume synonym hz_csv_volume_sy;
```

为 function 创建同义词，其中 FUNCTION 为必选关键字。如果不指定，则系统会默认寻找同名的 table 对象。

```SQL
create function synonym s_swu_udf_upper_aliyun_java_upper for public.swu_udf_upper_aliyun_java_upper;
--删除同义词
drop function synonym s_swu_udf_upper_aliyun_java_upper;
```

## 获取同义词

```SQL
show synonyms in  public where synonym_name='students_sy';
+--------------+-------------------------+-------------+-----------------------+
| synonym_name |       create_time       | target_type |       target_name     |
+--------------+-------------------------+-------------+-----------------------+
| students_sy  | 2024-06-14 10:21:00.504 | TABLE       | ql_ws.`public`.studen |
+--------------+-------------------------+-------------+-----------------------+
```