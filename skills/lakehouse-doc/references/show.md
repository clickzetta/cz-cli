# SHOW 语句

列出指定类型的现有对象。

## 语法结构
```sql
SHOW <object_type_plural> 
[ IN <scope_object_name> ] 
[ LIKE '<pattern>' | WHERE <expression>  ] 
[ LIMIT <num> ]
```

## 参数详解
1. 核心参数
- **`<object_type_plural>`**（必需）  
  需展示的对象类型

2. 作用域限定
- **`IN <scope_object_name>`**（可选）  
  指定对象的作用域层级，对应关系如下表：

| 对象类型                | 作用域格式             | 示例                  |
|-----------------------|----------------------|----------------------|
| TABLE/VIEW/MATERIALIZED VIEW/SYNONYM/VOLUME/TABLE STREAM/PIPE | `IN schema_name`          | `SHOW TABLES IN sales` |
| 作业                  | `IN VCLUSTER vc_name`        | `SHOW JOBS IN VCLUSTER prod` |
| 索引/列               | `IN table_name`           | `SHOW COLUMNS IN orders` |
| SCHEMA/VCLUSTER/USERS/ROLES/PIPES | `IN workspace_name `      | `SHOW SCHEMA IN workspace_name`   |
| 分区                  | 不支持使用 IN 关键字      | `SHOW PARTITIONS table_name`   |
| CONNECTION/SHARE/FUNCTION                | 不支持作用域限定       | `SHOW CONNECTIONS`   |


3. 结果过滤
- **`LIKE '<pattern>'`**（可选，与WHERE二选一）  
  使用通配符模式匹配对象名称（支持 `%` 和 `_`）
  ```sql
  SHOW TABLES LIKE 'temp%'  -- 匹配temp开头的表
  ```
  
- **`WHERE <expression>`**（可选，与LIKE二选一）
  支持用户根据命令返回的字段进行筛选。用户可以通过表达式对结果进行复杂过滤，目前只有 TABLE、TABLE STREAM、CONNECTION、VCLUSTER、JOB、SHARE、SYNONYM、PIPE 对象支持。对象类型与可筛选字段矩阵：

| 对象类型             | 核心过滤字段（支持全字段组合查询）                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TABLE**        | `table_name`, `is_view`, `is_materialized_view`, `is_external`, `is_dynamic`                                                                         |
| **TABLE STREAM** | `create_time`, `name`, `table_name`, `mode`, `comment`                                                                                               |
| **CONNECTION**   | `name`, `category`, `type`, `enabled`, `created_time`                                                                                                |
| **VCLUSTER**     | `name`, `vcluster_type`, `max_concurrency`, `state`, `creator`, `create_time`, `min_replicas`, `max_replicas`, `min_vcluster_size`, `max_vcluster_size`, `current_vcluster_size`, `preload_tables`, `current_replicas`, `auto_suspend_in_second`, `auto_scale_in_in_second`, `running_jobs`, `queued_jobs`, `error_message`, `provision_mode` |
| **JOB**          | `job_id`, `status`, `creator`, `priority`, `start_time`, `end_time`, `execution_time`, `vcluster_name`, `job_text`, `query_tag`                                    |
| **SHARE**        | `share_name`, `provider`, `provider_instance`, `scope`, `kind`                                                                                       |
| **SYNONYM**      | `synonym_name`, `create_time`, `target_type`, `target_name`                                                                                          |
| **PIPE**         | `pipe_name`, `pipe_kind`, `status`, `copy_statement`                                                                                                |
| **SCHEMA**       | `schema_name`, `type`                                                                                                |

  ```sql
  SHOW TABLES WHERE table_name=base_a_dt;
  ```

4. 结果限制
- **`LIMIT <num>`**（可选）
  限制返回结果数量
  ```sql
  SHOW TABLES LIMIT 10
  ```

5. 特殊语法形式
索引/列的 FROM 语法：对于索引和列对象，支持使用 `FROM` 替代 `IN TABLE`：
```sql
SHOW INDEXES FROM customers       -- 等效于 SHOW INDEXES IN TABLE customers
SHOW COLUMNS FROM order_details   -- 等效于 SHOW COLUMNS IN TABLE order_details
```

## 注意事项
1. CONNECTION 和 SHARE 不支持作用域限定
2. 模式匹配区分大小写
3. `WHERE` 子句支持标准 SQL 表达式语法
4. 返回结果默认按对象名称排序


## LIKE子句的使用示例

```SQL
-- 查找名称中包含'taxi'的所有表
SHOW TABLES LIKE '%taxi%';

-- 查找名称以'yellow'开头的所有表
SHOW TABLES LIKE 'yellow%';

-- 查找名称中第二个字符为'a'的所有schema
SHOW SCHEMAS LIKE '_a%';
```

## WHERE子句的使用示例

```SQL
-- 查找所有不是视图的表
SHOW TABLES WHERE is_view=false;

-- 查找所有外部表
SHOW TABLES WHERE is_external=true;

-- 查找特定schema中的所有表
SHOW TABLES WHERE schema_name='mcp_demo';

-- 使用多个条件进行过滤
SHOW TABLES WHERE is_view=false AND table_name LIKE '%taxi%';

-- 查找特定连接的卷
SHOW VOLUMES WHERE connection='xxx.storage_connection';

-- 查找外部卷
SHOW VOLUMES WHERE external=true;
```

## 使用建议

1. 当只需要按对象名称过滤时，使用LIKE子句更为简洁
2. 当需要基于对象的属性或特性进行筛选时，使用WHERE子句更为灵活
3. 对于不支持WHERE子句的对象类型，只能使用LIKE子句进行名称过滤
4. WHERE子句支持更复杂的过滤条件，包括逻辑运算符的组合

请注意，云器 Lakehouse 的 SHOW 命令功能与标准 SQL 中的 SHOW 命令相似，但有其特定的语法和支持范围。

## 具体的语法参考

[SHOW USERS](SHOWUSERS.md)

[SHOW GRANTS](show-grants-user.md)

[SHOW ROLES](SHOWROLES.md)

[SHOW GRANTS](SHOWGRANTS.md)

[SHOW CONNECTIONS](SHOWCONNECTIONS.md)

[SHOW SCHEMAS](show-schemas.md)

[查看外部SCHEMA](show-external-schemas.md)

[SHOW SHARES](show-shares.md)

[SHOW VCLUSTERS](show-vclusters.md)

[SHOW JOBS](show-jobs.md)

[SHOW DYNAMIC TABLE REFRESH HISTORY](refresh-history.md)

[SHOW TABLES](SHOWTABLES.md)

[SHOW VIEWS](show-views.md)

[列出当前空间下的物化视图](show-materialized-view.md)

[列出动态表](show-dynamic-table.md)

[SHOW VOLUMES](<show-volume.md>)

[SHOW TABLE STREAMS](show-table-streams.md)

[SHOW SYNONYMS](show-synonyms.md)

[SHOW INDEX](SHOW-INDEX.md)

[SHOW PARTITIONS](list-partition.md)

[SHOW COLUMNS](<show-columns.md>)

[SHOW PIPES](<pipe-syntax.md>)

