## 生成列
生成列（Generated Columns）是数据库表中的一列，其值由表中的其他列的值通过一个表达式自动计算生成。这种列在创建时就定义了一个计算规则，数据库管理系统会根据这个规则自动填充列的值，而不需要用户显式地插入或更新这些值。应用场景比如数据集成同步时不支持转化，可以使用生成列进行转化。

## 语法

```SQL
CREATE TABLE [ IF NOT EXISTS ] table_name
(
    column_definition GENERATED ALWAYS AS ( expr ), [column_definition,...]
)
[ PARTITIONED BY (column_name column_type | column_name ) ];
```


* **GENERATED ALWAYS AS (expr)**：通过表达式`expr`自动生成列的值。表达式可以包含常量和内置标量确定性SQL函数，不支持非确定性函数如（current\_date\random\current\_timestamp\上下文函数）或运算符，不支持聚合函数、窗口函数或表函数。支持分区列使用生成列

**示例**：

```SQL
-- 正确使用
CREATE TABLE t_genet (
    col1 TIMESTAMP,
    hour int GENERATED ALWAYS AS (hour(col1)),
    pt STRING GENERATED ALWAYS AS (date_format(col1, 'yyyy-MM-dd'))
) PARTITIONED BY (pt);
```
### 生成列和默认值区别

1. **分区列支持**：

   1. **默认值**：当前不支持为分区列设置默认值。
   2. **生成列**：支持为分区列生成值。

2. **函数支持**：

   1. **默认值**：支持使用非确定性函数，如 `current_timestamp()`
   2. **生成列**：不支持非确定性函数，只能使用确定性的标量函数。

3. **插入操作中的值指定**：

   1. **默认值**：在插入数据时，可以为列指定一个静态值，如果未指定，则使用默认值。
   2. **生成列**：在插入数据时，不能为生成列指定值，其值完全由生成表达式决定。

4. **列值来源**：

   1. **默认值**：不支持列的值来自其他列的转换。
   2. **生成列**：支持列的值来自其他列的转换，即可以基于其他列的值计算生成。

5. **现有数据行的处理**：

   1. **默认值**：当为现有表添加带有默认值的列时，已存在的数据行中的该列将填充为null。
   2. **生成列**：对于已存在的数据行，生成列的值将根据生成表达式进行转换，并显示转换后的数据。

### 使用限制

* 使用生成列时，您不能在插入操作中显式指定该列的值，它将由表达式自动生成。但是为了兼容Hive语法，Lakehouse允许您为分区字段指定一个静态值。然而，指定的静态值不会生效，查询结果仍然是由指定生成列表达式结果决定
* 不支持使用实时接口和批量接口写入，包括Studio数据集成的批量导入和实时写入。
* 生成列不支持非确定性函数如（current\_date\random\current\_timestamp\上下文函数）或运算符，不支持聚合函数、窗口函数或表函数。

### 插入数据

* 当使用生成列时，您不能为该列指定常量值。例如，如果hour列是由`col1`生成的，您不能在插入时指定hour的值。指定则会报错。

**错误示例**：

```SQL
-- 指定的2024-09-26将不会生效，因为pt是由col1生成的，虽然不会报错，但是值不会写入当中
CREATE TABLE t_genet (
    col1 TIMESTAMP,
    pt STRING GENERATED ALWAYS AS (date_format(col1, 'yyyy-MM-dd'))
) PARTITIONED BY (pt);
INSERT INTO t_genet (col1,pt) VALUES (current_timestamp, '2024-09-26');
```

**正确示例**：

```SQL
-- 可以运行，只插入col1，pt将由生成规则自动计算
INSERT INTO t_genet (col1) VALUES (current_timestamp);
```

# 添加字段时指定生成列

## 语法

```SQL
-- 添加列
ALTER TABLE table_name ADD COLUMN
      column1_name_identifier data_type [column_properties]
      [FIRST | AFTER column1_name_identifier]  ,....

column_properties:==
    GENERATED ALWAYS AS ( expr ) |
    COMMENT column_comment 
```

* **GENERATED ALWAYS AS (expr)**：指定一个表达式，用于自动生成新添加列的值。对于表中已存在的数据行，该列将根据表达式的结果填充值。表达式可以包含常量和内置标量确定性SQL函数，非确定性函数如（current\_date\random\current\_timestamp等）或运算符，不支持聚合函数、窗口函数或表函数。


## 使用限制

* 不支持在已有的列添加生成列

## 示例

### 添加生成列

```SQL
ALTER TABLE my_table ADD COLUMN
    generated_col TIMESTAMP GENERATED ALWAYS AS (date_format(col1, 'yyyy-MM-dd')) FIRST;
```

在这个例子中，`generated_col` 将被添加为表中的第一列，并且所有现有的数据行的 `generated_col` 将根据当前时间戳生成值。
