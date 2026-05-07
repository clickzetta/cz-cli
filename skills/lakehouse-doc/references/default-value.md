## 默认值

### 语法

```SQL
CREATE TABLE [ IF NOT EXISTS ] table_name
(
    column_definition DEFAULT default_expression, [column_definition,...]
)
[ PARTITIONED BY (column_name column_type | column_name ) ];
```

* **DEFAULT default_expression**：为新添加的列定义一个默认值。如果在 INSERT、UPDATE 或 MERGE 操作中未指定该列的值，将自动使用此默认值。对于添加列之前已存在的数据行，该列将填充为 null。支持非确定性函数（如 `current_date`、`random`、`current_timestamp`、上下文函数）和常量值。

### 生成列和默认值区别

1. **分区列支持**：
   * **默认值**：当前不支持为分区列设置默认值。
   * **生成列**：支持为分区列生成值。

2. **函数支持**：
   * **默认值**：支持使用非确定性函数，如 `current_timestamp()`。
   * **生成列**：不支持非确定性函数，只能使用确定性的标量函数。

3. **插入操作中的值指定**：
   * **默认值**：在插入数据时，可以为列指定一个静态值，如果未指定，则使用默认值。
   * **生成列**：在插入数据时，不能为生成列指定值，其值完全由生成表达式决定。

4. **列值来源**：
   * **默认值**：不支持列的值来自其他列的转换。
   * **生成列**：支持列的值来自其他列的转换，即可以基于其他列的值计算生成。

5. **现有数据行的处理**：
   * **默认值**：当为现有表添加带有默认值的列时，已存在的数据行中的该列将填充为 null。
   * **生成列**：对于已存在的数据行，生成列的值将根据生成表达式进行计算，并显示计算结果。

### 使用限制

* 不支持分区列使用默认值。
* 支持批量接口写入，包括Studio数据集成的批量导入。实时接口写入时默认值不会生效，因为调用实时接口时必须指定所有的列。
* 不支持类似生成列中可以引用其他列的函数方式。

### 插入数据

```SQL
CREATE TABLE t_default
(
    id   int,
    col1 string DEFAULT current_timestamp (),
    col2 string DEFAULT '1',
    col3 int    DEFAULT 1,
    clo4 json   DEFAULT '1',
    col5 DOUBLE DEFAULT random(),
    col6 date   DEFAULT current_date()
);
INSERT INTO t_default (id) VALUES (1);
```

## 添加字段时指定默认值

### 语法

```SQL
-- 添加列
ALTER TABLE table_name ADD COLUMN
      column1_name_identifier data_type [column_properties]
      [FIRST | AFTER column1_name_identifier]  ,....

column_properties:==
    DEFAULT default_expression |
    COMMENT column_comment 
```

* **DEFAULT default_expression**：为新添加的列定义一个默认值。如果在 INSERT、UPDATE 或 MERGE 操作中未指定该列的值，将自动使用此默认值。对于添加列之前已存在的数据行，该列将填充为 null。

### 使用限制

* 不支持为已有的列添加默认值。

### 示例

#### 添加列并指定默认值

```SQL
ALTER TABLE my_table ADD COLUMN
    new_col INT DEFAULT 0 AFTER existing_col;
```

在这个例子中，`new_col` 将被添加到 `existing_col` 后面，并且所有现有数据行的 `new_col` 将被设置为默认值 null。
