# LAKEHOUSE INFORMATION\_SCHEMA元数据视图服务介绍

LAKEHOUSE提供了工作空间级别的INFORMATION\_SCHEMA元数据视图服务，通过INFORMATION\_SCHEMA可查看当前空间的元数据信息及作业历史等信息。INFORMATION\_SCHEMA基于ANSI SQL-92标准设计，并扩展了云器LAKEHOUSE特有的字段和视图。它随LAKEHOUSE空间创建而默认提供，您可从中查看关心的元数据视图。

## 使用说明

* 视图当前阶段会存在延时15分钟左右，JOB\_HISTORY、MATERIALIZED\_VIEW刷新视图保留60天记录。
* 最新的在线元数据信息可通过 SHOW 命令查看，例如：SHOW TABLES、SHOW JOBS 等命令将返回实时元数据信息。
* INFORMATION\_SCHEMA下的视图均为只读，不可修改、删除。
* 视图字段根据功能演进可能发生变化。在周期任务中使用视图时应避免使用SELECT \*直接查询所有字段，强烈建议使用SELECT COLUMN\_NAME方式选择具体需要的字段进行查询，避免视图字段发生变更时导致周期任务出错。

## 权限要求

* 具备workspace\_admin角色

## 使用示例

获取当前空间的所有表信息：

```SQL
SELECT * FROM information_schema.tables;
```

获取当前空间的所有作业信息：

```SQL
SELECT * FROM information_schema.job_history;
```

获取当前空间的所有物化视图（Materialized View）信息：

```SQL
SELECT * FROM information_schema.materialized_views;
```

## 授权操作

* 由workspace\_admin角色授权的角色或用户

授权给某个角色：

```SQL
GRANT ALL ON ALL VIEWS IN SCHEMA information_schema TO ROLE <role_name>;
```

授权给某个用户：

```SQL
GRANT ALL ON ALL VIEWS IN SCHEMA information_schema TO USER <user_name>;
```

## 注意事项

* 请确保您已经具备了相应的权限要求，否则无法使用INFORMATION\_SCHEMA元数据视图服务。
* 在使用INFORMATION\_SCHEMA时，请注意只读的特性，不可对视图进行修改和删除操作。
* 请在周期任务中使用具体需要的字段进行查询，避免使用SELECT \*查询所有字段，以免因视图字段变更导致周期任务出错。