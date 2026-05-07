## 功能

`DROP TABLE` 命令用于删除数据库中的表。请注意，执行此操作后，表及数据将被删除。如果要恢复，请使用 [UNDROP](<UNDROP-TABLE.md>) 命令，并确保删除的对象在 [TIME TRAVEL](<timetravel-summary.md>) 保留周期内，否则将无法恢复。

## 语法

```SQL
DROP TABLE [ IF EXISTS ] [schema_name.]<table_name>
```

### 参数说明

- `IF EXISTS`：可选。如果指定的表不存在，系统不会报错。
- `schema_name`：可选。指定 schema 的名称。如果未指定，默认使用当前用户的 schema。
- `table_name`：要删除的表名称。

## 示例

1. 删除当前 schema 下名为 `my_table` 的表：

```SQL
DROP TABLE my_table;
```

2. 删除名为 `my_table` 的表，如果表不存在，不报错：

```SQL
DROP TABLE IF EXISTS my_table;
```

3. 删除名为 `my_schema` 下的 `my_table` 表：

```SQL
DROP TABLE my_schema.my_table;
```

4. 删除名为 `my_schema` 下的 `my_table` 表，如果表不存在，不报错：

```SQL
DROP TABLE IF EXISTS my_schema.my_table;
```

## 注意事项

- 在执行 `DROP TABLE` 命令前，请确保已对表中的数据进行备份，以防止数据丢失。
- 在删除表之前，请确保该表不再被其他数据库对象（如视图、TABLE STREAM 等）引用，否则可能导致错误。