# 功能描述

本功能允许用户通过 ALTER 语句对表中的列进行修改，包括添加列、修改列、删除列以及重命名列。同时支持复杂类型的变化，如 struct、array 和 map 等。

# 添加字段

## 语法

```sql
-- 添加列
ALTER TABLE table_name ADD COLUMN
      column1_name_identifier data_type [COMMENT comment]
      [FIRST | AFTER column1_name_identifier | BEFORE column1_name_identifier ]  ,....

column_name_identifier :==
    -- 普通字段
    column_name
    -- 复杂类型struct表示方法
    -- struct类型struct,<x: double, y: double>
    column_name.struct_column_name  
    -- array类型嵌套struct表示方法
    -- 添加字段,array<struct<x: double, y: double>>
    column_name.ELEMENT.struct_column_name
    --map类型嵌套struct表示方法
    --map key 添加字段
    column_name.KEY.struct_column_name 
    --map value添加字段
    column_name.VALUE.struct_column_name    
```

## 参数说明

* **column_name_identifier**：字段标识符，用于指定添加、删除或重命名的字段名。
* **FIRST | AFTER column_name_identifier**：指定字段添加的位置，可以添加到字段之前或之后。

## 使用示例

1. 添加普通字段：

   ```sql
   ALTER TABLE my_table ADD COLUMN new_column INT;
   ```

2. 添加复杂类型字段：

   ```sql
   CREATE TABLE my_complex_table (
       point STRUCT<x: INT, y: DOUBLE>,
       points ARRAY<STRUCT<x: DOUBLE, y: DOUBLE>>,
       points_map MAP<STRUCT<x: INT>, STRUCT<a: INT>>
   );

   -- 在struct中添加字段
   ALTER TABLE my_complex_table ADD COLUMN point.z DOUBLE;

   --map value中struct添加字段
   ALTER TABLE my_complex_table ADD COLUMN points_map.value.b INT;

   --map key中struct添加字段
   ALTER TABLE my_complex_table ADD COLUMN points_map.key.y INT;

   --array中struct添加字段
   ALTER TABLE my_complex_table ADD COLUMN points.element.z DOUBLE;
   --添加多个字段同时指定位置
    CREATE TABLE test (a string);
    ALTER TABLE test  ADD COLUMN b string, c string, CHANGE COLUMN a AFTER c;

   ```

# 删除字段

## 语法

```sql
ALTER TABLE table_name DROP COLUMN column_name_identifier [, column_name_identifier ... ]
```

## 使用示例

1. 删除普通字段：

   ```sql
   ALTER TABLE my_table DROP COLUMN old_column;
   ```

2. 删除复杂类型字段：

   ```sql
   ALTER TABLE my_complex_table DROP COLUMN point.z;
   ALTER TABLE my_complex_table DROP COLUMN points.element.y;
   ALTER TABLE my_complex_table DROP COLUMN points_map.key.x;
   ```

# 重命名字段

## 语法

```sql
ALTER TABLE table_name RENAME COLUMN column_name_identifier TO new_column_name_identifier;
```

## 使用示例

1. 重命名普通字段：

   ```sql
   ALTER TABLE my_table RENAME COLUMN old_name TO new_name;
   ```

2. 重命名复杂类型字段：

   ```sql
   ALTER TABLE my_complex_table RENAME COLUMN point.x TO xx;
   ALTER TABLE my_complex_table RENAME COLUMN points.element.x TO xx;
   ALTER TABLE my_complex_table RENAME COLUMN points_map.key.x TO xx;
   ```

# 修改字段

## 语法

```sql
-- 修改字段位置
ALTER TABLE table_name CHANGE COLUMN column_name_identifier { FIRST | AFTER column_identifier }

-- 修改字段类型
ALTER TABLE table_name CHANGE COLUMN column_name_identifier TYPE data_type

-- 修改字段注释
ALTER TABLE table_name CHANGE COLUMN column_name_identifier COMMENT 'comment'
```

DECIMAL 类型转换**只支持精度（整数位）和小数位同时增大**的场景。

**DECIMAL 类型的两个参数**

```
DECIMAL(P, S)  ├─ P（Precision）：总位数（整数位 + 小数位）  └─ S（Scale）：小数位数
```

例如：`DECIMAL(10, 2)` 表示

* 总共 10 位数字
* 其中 2 位是小数位

**场景 1：两个参数都增大**

```sql
-- 源表定义
CREATE TABLE test_alter(a DECIMAL(10,2));
-- ✅ 正确：整数位和小数位都增大
ALTER TABLE test_alter CHANGE COLUMN a TYPE DECIMAL(12,2);
-- 说明：从 10 位增加到 12 位，小数位不变
ALTER TABLE test_alter CHANGE COLUMN a TYPE DECIMAL(13,3);
-- 说明：从 10 位增加到 13 位，小数位从 2 增加到 3
```

**场景 2：只增大整数位，小数位不变**

```sql
ALTER TABLE test_alter CHANGE COLUMN a TYPE DECIMAL(15,2);
-- 从 DECIMAL(10,2) 转为 DECIMAL(15,2)
-- 整数位：从 8 位（10-2）增加到 13 位（15-2）
```

**场景 3：同时增大整数位和小数位**

```sql
ALTER TABLE test_alter CHANGE COLUMN a TYPE DECIMAL(20,5);
-- 从 DECIMAL(10,2) 转为 DECIMAL(20,5)
-- 整数位增大，小数位也增大
-- 这是最安全的转换方式
```

❌ 错误的类型转换

**错误 1：整数位不变，只增大小数位**

```sql
-- ❌ 错误
ALTER TABLE test_alter CHANGE COLUMN a TYPE DECIMAL(10,3);
-- 原因：总位数不变，只是改变了小数位比例
-- 结果：系统会报错或数据可能丢失
```

**错误 2：减少任一参数**

```sql
-- ❌ 错误：减少总位数
ALTER TABLE test_alter CHANGE COLUMN a TYPE DECIMAL(8,2);
-- ❌ 错误：减少小数位
ALTER TABLE test_alter CHANGE COLUMN a TYPE DECIMAL(12,1);
-- ❌ 错误：两个都减少
ALTER TABLE test_alter CHANGE COLUMN a TYPE DECIMAL(8,1);
```

**错误 3：只增大小数位**

```sql
-- ❌ 错误
ALTER TABLE test_alter CHANGE COLUMN a TYPE DECIMAL(10,3);
-- 问题：总位数从 10 不变为 10，但小数位从 2 增加到 3
-- 结果：整数位从 8 减少到 7，可能导致数据溢出或精度丢失
```

## 当前支持的类型转换

|          |          |     |        |       |        |                                                    |      |         |        |        |
| -------- | -------- | --- | ------ | ----- | ------ | -------------------------------------------------- | ---- | ------- | ------ | ------ |
| from \\ to | smallint | int | bigint | float | double | decimal                                            | date | varchar | char   | string |
| tinyint  | ☑️       | ☑️  | ☑️     |       |        |                                                    |      |         |        |        |
| smallint | ☑️       | ☑️  | ☑️     |       |        |                                                    |      |         |        |        |
| int      |          | ☑️  | ☑️     |       |        |                                                    |      |         |        |        |
| bigint   |          |     | ☑️     |       |        |                                                    |      |         |        |        |
| float    |          |     |        | ☑️    | ☑️     |                                                    |      |         |        |        |
| double   |          |     |        |       | ☑️     |                                                    |      |         |        |        |
| decimal  |          |     |        |       |        | DECIMAL 类型转换满足以下条件时支持：P' ≥ P 且 (P' - S') ≥ (P - S) |      |         |        |        |
| Date     |          |     |        |       |        |                                                    | ☑️   |         |        |        |
| Varchar  |          |     |        |       |        |                                                    |      | 允许变得更长 |        | ☑️     |
| Char     |          |     |        |       |        |                                                    |      |         | 允许变得更长 | ☑️     |
| String   |          |     |        |       |        |                                                    |      |         |        |        |

^
