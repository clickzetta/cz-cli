## 功能概述

使用 External Catalog，用户可以在不同的数据源之间进行联合查询，如同它们是同一个数据库内的数据一样。同时，也可以将外部数据源和 Lakehouse 的表进行关联查询。

## 语法

```SQL
SELECT <expr> FROM external_catalog_name.schema_name.table_name;
```

### 参数说明

* `<expr>`：用户希望查询的字段或表达式。
* `external_catalog_name`：外部目录的名称。
* `schema_name`：模式名称，用于组织数据库对象。
* `table_name`：表的名称，用户希望查询的数据集。
  **注意事项**
查询 External Catalog 下的表必须使用三层结构语法。

## 示例

```SQL
SELECT * FROM my_external_catalog.my_schema.my_table;
```


