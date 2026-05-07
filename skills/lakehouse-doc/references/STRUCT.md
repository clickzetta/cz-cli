# STRUCT

`STRUCT` 函数用于创建一个结构体，它可以包含多个不同类型的值。结构体的组成通过一系列字段名和对应的数据类型来描述。结构体在处理复杂数据时非常有用，可以方便地将多个相关数据组织在一起。

## 语法

```
STRUCT<field1_name: field1_type, field2_name: field2_type, …>
```

## 示例

1. 创建一个包含公司名称和员工数量的结构体：
    ```
   CREATE TABLE TABLE_STRUCT(col struct<company_name:string,employee_count:int>)
    ```

2. 使用 `named_struct` 函数创建一个具有明确字段名的结构体：

   ```
   SELECT named_struct('company_name', 'ClickZetta', 'employee_count', 5);
   ```


3. 在查询中使用结构体并结合其他字段：

   ```
   SELECT
    col.company_name,
    col.employee_count,
   FROM TABLE_STRUCT;
   ```

