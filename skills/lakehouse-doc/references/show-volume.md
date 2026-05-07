# SHOW VOLUMES

## 语法结构

```sql
SHOW VOLUMES [IN schema_name] [LIKE 'pattern' | WHERE expr] [LIMIT num]
```

## 参数说明
1. `LIKE pattern`：可选参数，用于按 volume 名称进行模式匹配过滤。支持不区分大小写的匹配，可使用 SQL 通配符 `%`（匹配任意数量字符）和 `_`（匹配单个字符）。示例：`LIKE '%testing%'`。注意：不支持与 `WHERE` 条件同时使用。

2. `IN schema_name`：可选参数，用于指定特定的 schema 名称，列举该 schema 下的所有 volume。

3. `WHERE expr`：可选参数，用于根据 `SHOW VOLUMES` 命令显示的字段进行筛选，支持使用表达式对结果进行精确过滤。

## 显示字段

| 字段 | 描述 |
| --- | --- |
| volume_name | Volume 的名称 |
| create_time | Volume 的创建时间 |
| external | 是否为外部 Volume |
| workspace_name | Volume 所属的工作区名称 |
| url | Volume 的 URL 地址 |
| recursive_file_lookup | 是否启用递归文件查找 |
| connection | Volume 的连接信息 |

## 示例

```sql
SHOW VOLUMES;
```

```sql
SHOW VOLUMES WHERE volume_name = 'zettapark_csv';
```

```sql
SHOW VOLUMES WHERE external = true;
```

```sql
SHOW VOLUMES WHERE workspace_name = 'xxx';
```

```sql
SHOW VOLUMES WHERE recursive_file_lookup = false;
```

查询哪些 Volume 使用 xxx.storage_connection：
```sql
SHOW VOLUMES WHERE connection = 'xxx.storage_connection';
```

## 说明

该命令用于列出当前 schema 下的所有 Volume 信息，并支持通过 WHERE 子句根据指定条件进行过滤显示。