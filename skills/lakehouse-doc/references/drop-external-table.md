# 功能

`DROP TABLE` 命令用于从数据库中移除表。在 Lakehouse 中，使用 `DROP TABLE` 可以删除外部表，这一操作不会删除表中的实际数据，仅删除 Lakehouse 中的元数据对象。

# 语法

```sql
DROP TABLE [ IF EXISTS ] [ schema_name. ] table_name;
```

# 参数说明

- **IF EXISTS**：（可选）如果指定的表不存在，使用此选项可以避免系统抛出错误。
- **schema_name**：（可选）指定要删除表的 schema 名称。如果未指定，将默认使用当前用户的 schema。
- **table_name**：要删除的表的名称。

# 示例

1.  **删除当前 schema 下的表**：

   ```sql
   DROP TABLE my_table;
   ```

2. **删除表，如果不存在则不报错**：

   ```sql
   DROP TABLE IF EXISTS my_table;
   ```

3.  **删除特定 schema 下的表**：

   ```sql
   DROP TABLE my_schema.my_table;
   ```

4. **删除特定 schema 下的表，如果不存在则不报错**：

   ```sql
   DROP TABLE IF EXISTS my_schema.my_table;
   ```


