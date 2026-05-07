#### load\_history函数

**功能描述**： load\_history函数用于查看表的COPY作业导入文件历史，保留期为7天。同时，Pipe在执行时会根据load\_history避免重复导入已有的文件，确保数据的唯一性。

**函数语法**：

```SQL
load_history('schema_name.table_name')
```

* **schema\_name.table\_name**：指定要查看导入历史的表名。

**使用案例**：

```SQL
SELECT * FROM load_history('myschema.mytable');
```