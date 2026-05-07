# 功能


`MERGE INTO` 语句用于根据源表或子查询中的值更新目标表中的记录。当源表包含目标表中的新行（待插入）、修改行（待更新）和删除行（待删除）时，可以使用此功能来同步目标表的数据。


# 语法


```SQL
MERGE INTO target_table 
   USING source_table
   ON merge_condition
   { WHEN MATCHED [ AND matched_condition ] THEN matched_action |
    WHEN  MATCHED [ AND matched_condition ] THEN matched_action |
    --当WHEN MATCHED语句和WHEN NOT MATCHED 语句同时存在时，MERGE INTO语句中只能存在一个WHEN NOT MATCHED
    WHEN NOT MATCHED [ AND not_matched_by_source_condition ] THEN not_matched_by_source_action } 
-- 参数解释
matched_action ::=
    UPDATE SET <column_name> = <expr> [ , <column_name2> = <expr2> ... ] 
    | DELETE 
not_matched_action ::=
    INSERT [ ( <column_name> [ , ... ] ) ] VALUES ( <expr> [ , ... ] )
```


## 参数说明


- `target_table`：指定目标表，可以使用别名。
- `source_table`：指定要与目标表进行比较的表或子查询，可以使用别名。
- `merge_condition`：定义如何将源表中的行与目标表中的行进行匹配，返回布尔类型的表达式。
- `WHEN MATCHED [ AND matched_condition ]`：当源行根据 `merge_condition` 和可选的 `matched_condition` 与目标表行匹配时，执行 `WHEN MATCHED` 子句。
  - 如果对于匹配 `merge_condition` 的源行和目标行对，没有任何 `WHEN MATCHED` 条件的计算结果为 true，则目标行保持不变。
  - 如果存在多个 `WHEN MATCHED` 子句，则会按照它们的指定顺序对其进行求值。每个 `WHEN MATCHED` 子句都必须具有一个 `matched_condition`。
- `WHEN NOT MATCHED [ AND not_matched_condition ]`：当源行根据 `merge_condition` 和可选的 `not_matched_condition` 与目标表中的任何行都不匹配时，执行 `WHEN NOT MATCHED` 子句。
  - 只能存在一个`WHEN NOT MATCHED`语句
- `matched_action`：
  - `DELETE`：删除匹配的目标表行。
  - `UPDATE`：更新匹配的目标表行。使用 `UPDATE SET column1 = source.column1 [, column2 = source.column2 ...]`。
- `not_matched_action`：
  - `INSERT`：使用源数据集中的相应列插入目标表，支持指定字段插入。对于未指定的目标列，则插入为 `NULL`。


## 注意事项


当执行 `MERGE INTO` 语句可能产生不确定结果时，系统会报错。产生这种情况的原因有：


1. 如果 `ON` 子句使得源表中的多于 1 行与目标表中的行匹配，SQL 标准要求引发错误。
2. 如果 `ON` 子句使得源表中的多于 1 行与目标表中的行匹配，同时在 `AND case_predicate` 条件过滤后仍有多条记录。
3. 当WHEN MATCHED语句和WHEN NOT MATCHED 语句同时存在时，MERGE INTO语句中只能存在一个WHEN NOT MATCHED
4. 当存在多个 WHEN MATCHED 子句时，UPDATE 语句必须在 DELETE 语句之前。




确定性结果的情况：


1. 如果 `ON` 子句使得源表中的 1 行与目标表中的行匹配。
2. 如果 `ON` 子句使得源表中的多于 1 行与目标表中的行匹配，同时在 `AND case_predicate` 条件过滤后只有一条记录。




## 详细使用示例


### 案例1：当匹配条件满足时，删除目标表中的数据


**场景**：删除在源表中存在的所有用户记录（标记删除）


**建表语句**


```sql
-- 目标表：存储用户信息
CREATE TABLE users_target (
  id INT,
  name STRING,
  value INT,
  updated_at STRING,
  marked_for_deletion BOOLEAN
);


-- 源表：待同步的用户数据
CREATE TABLE users_source (
  id INT,
  name STRING,
  value INT,
  updated_at STRING,
  marked_for_deletion BOOLEAN
);
```


**目标表插入的数据：**
```sql
INSERT INTO users_target VALUES 
(1, 'Alice', 100, '2024-01-01', false),
(2, 'Bob', 200, '2024-01-02', false),
(3, 'Charlie', 300, '2024-01-03', false);
```

```
+----+---------+-------+------------+---------------------+
| id | name    | value | updated_at | marked_for_deletion |
+----+---------+-------+------------+---------------------+
| 1  | Alice   | 100   | 2024-01-01 | false               |
+----+---------+-------+------------+---------------------+
| 2  | Bob     | 200   | 2024-01-02 | false               |
+----+---------+-------+------------+---------------------+
| 3  | Charlie | 300   | 2024-01-03 | false               |
+----+---------+-------+------------+---------------------+
```


**源表插入的数据：**
```sql
INSERT INTO users_source VALUES 
(1, 'Alice', 100, '2024-01-01', false),
(2, 'Bob', 200, '2024-01-02', false);
```

```
+----+-------+-------+------------+---------------------+
| id | name  | value | updated_at | marked_for_deletion |
+----+-------+-------+------------+---------------------+
| 1  | Alice | 100   | 2024-01-01 | false               |
+----+-------+-------+------------+---------------------+
| 2  | Bob   | 200   | 2024-01-02 | false               |
+----+-------+-------+------------+---------------------+
```


**MERGE SQL**


```sql
MERGE INTO users_target t USING users_source s
ON t.id = s.id
WHEN MATCHED THEN DELETE;
```


**执行结果**


```
+----+---------+-------+------------+---------------------+
| id | name    | value | updated_at | marked_for_deletion |
+----+---------+-------+------------+---------------------+
| 3  | Charlie | 300   | 2024-01-03 | false               |
+----+---------+-------+------------+---------------------+
```


**说明**：源表中 id 为 1 和 2 的记录在目标表中找到匹配项，这两条记录被删除。id 为 3 的 Charlie 记录因为在源表中没有匹配项，保持不变。




### 案例2：基于时间戳的条件更新


**场景**：只在源表数据更新时间比目标表更新时间更新时，才更新目标表的值


**建表语句**


```sql
-- 目标表：产品信息
CREATE TABLE products_target (
  id INT,
  name STRING,
  col1 STRING,
  updated_at STRING
);


-- 源表：新的产品数据
CREATE TABLE products_source (
  id INT,
  name STRING,
  col1 STRING,
  updated_at STRING
);
```


**初始目标表数据：**
```sql
INSERT INTO products_target VALUES 
(1, 'Product A', 'value_old', '2024-01-01'),
(2, 'Product B', 'value_old', '2024-01-02'),
(3, 'Product C', 'value_old', '2024-01-03');
```

```
+----+------------+-----------+------------+
| id | name       | col1      | updated_at |
+----+------------+-----------+------------+
| 1  | Product A  | value_old | 2024-01-01 |
+----+------------+-----------+------------+
| 2  | Product B  | value_old | 2024-01-02 |
+----+------------+-----------+------------+
| 3  | Product C  | value_old | 2024-01-03 |
+----+------------+-----------+------------+
```


**初始源表数据：**
```sql
INSERT INTO products_source VALUES 
(1, 'Product A', 'value_new', '2024-01-10'),
(2, 'Product B', 'value_old', '2024-01-01'),
(4, 'Product D', 'value_new', '2024-01-04');
```

```
+----+------------+-----------+------------+
| id | name       | col1      | updated_at |
+----+------------+-----------+------------+
| 1  | Product A  | value_new | 2024-01-10 |
+----+------------+-----------+------------+
| 2  | Product B  | value_old | 2024-01-01 |
+----+------------+-----------+------------+
| 4  | Product D  | value_new | 2024-01-04 |
+----+------------+-----------+------------+
```


**MERGE SQL**


```sql
MERGE INTO products_target t USING products_source s
ON t.id = s.id
WHEN MATCHED AND t.updated_at < s.updated_at THEN UPDATE SET t.col1 = s.col1;
```

**执行结果**


```
+----+------------+-----------+------------+
| id | name       | col1      | updated_at |
+----+------------+-----------+------------+
| 1  | Product A  | value_new | 2024-01-01 |
+----+------------+-----------+------------+
| 2  | Product B  | value_old | 2024-01-02 |
+----+------------+-----------+------------+
| 3  | Product C  | value_old | 2024-01-03 |
+----+------------+-----------+------------+
```


**说明**：
- **Product A (id=1)**：源表的更新时间 `2024-01-10` > 目标表的 `2024-01-01`，条件满足，col1 被更新为 `value_new`
- **Product B (id=2)**：源表的更新时间 `2024-01-01` ≤ 目标表的 `2024-01-02`，条件不满足，保持不变
- **Product C (id=3)**：源表中没有对应记录（id=3），不进行任何操作，保持不变
- **Product D (id=4)**：源表新增，由于不存在 ON 条件的 WHEN NOT MATCHED 子句，不插入




### 案例3：删除标记与条件更新的组合


**场景**：对用户数据进行操作，标记为删除的用户直接删除，其他匹配的用户更新其状态信息


**建表语句**


```sql
-- 目标表：用户信息
CREATE TABLE users_data_target (
  id INT,
  name STRING,
  marked_for_deletion BOOLEAN,
  updated_at STRING,
  value STRING
);


-- 源表：同步的用户数据
CREATE TABLE users_data_source (
  id INT,
  name STRING,
  marked_for_deletion BOOLEAN,
  updated_at STRING,
  value STRING
);
```


**初始目标表数据：**
```sql
INSERT INTO users_data_target VALUES 
(1, 'User A', false, '2024-01-01', 'active'),
(2, 'User B', true, '2024-01-02', 'inactive'),
(3, 'User C', false, '2024-01-03', 'active'),
(4, 'User D', true, '2024-01-04', 'inactive');
```

```
+----+--------+---------------------+------------+----------+
| id | name   | marked_for_deletion | updated_at | value    |
+----+--------+---------------------+------------+----------+
| 1  | User A | false               | 2024-01-01 | active   |
+----+--------+---------------------+------------+----------+
| 2  | User B | true                | 2024-01-02 | inactive |
+----+--------+---------------------+------------+----------+
| 3  | User C | false               | 2024-01-03 | active   |
+----+--------+---------------------+------------+----------+
| 4  | User D | true                | 2024-01-04 | inactive |
+----+--------+---------------------+------------+----------+
```


**初始源表数据：**
```sql
INSERT INTO users_data_source VALUES 
(1, 'User A', false, '2024-01-15', 'updated'),
(2, 'User B', true, '2024-01-20', 'to_delete'),
(3, 'User C', false, '2024-01-10', 'updated'),
(5, 'User E', false, '2024-01-05', 'new_user');
```

```
+----+--------+---------------------+------------+-----------+
| id | name   | marked_for_deletion | updated_at | value     |
+----+--------+---------------------+------------+-----------+
| 1  | User A | false               | 2024-01-15 | updated   |
+----+--------+---------------------+------------+-----------+
| 2  | User B | true                | 2024-01-20 | to_delete |
+----+--------+---------------------+------------+-----------+
| 3  | User C | false               | 2024-01-10 | updated   |
+----+--------+---------------------+------------+-----------+
| 5  | User E | false               | 2024-01-05 | new_user  |
+----+--------+---------------------+------------+-----------+
```


**MERGE SQL**


```sql
MERGE INTO users_data_target t USING users_data_source s
ON t.id = s.id
WHEN MATCHED AND t.marked_for_deletion = false THEN UPDATE SET t.updated_at = s.updated_at, t.value = s.value
WHEN MATCHED AND t.marked_for_deletion = true THEN DELETE;
```


**执行结果**


```
+----+--------+---------------------+------------+---------+
| id | name   | marked_for_deletion | updated_at | value   |
+----+--------+---------------------+------------+---------+
| 1  | User A | false               | 2024-01-15 | updated |
+----+--------+---------------------+------------+---------+
| 3  | User C | false               | 2024-01-10 | updated |
+----+--------+---------------------+------------+---------+
| 4  | User D | true                | 2024-01-04 | inactive|
+----+--------+---------------------+------------+---------+
```


**说明**：
- **User A (id=1)**：`marked_for_deletion=false`，满足第一个 WHEN MATCHED 条件，更新 `updated_at` 和 `value`
- **User B (id=2)**：`marked_for_deletion=true`，满足第二个 WHEN MATCHED 条件，被删除
- **User C (id=3)**：`marked_for_deletion=false`，满足第一个 WHEN MATCHED 条件，更新 `updated_at` 和 `value`
- **User D (id=4)**：源表中没有对应记录，保持不变
- **User E (id=5)**：源表新增，但没有 WHEN NOT MATCHED 子句，不插入


---


### 案例4：插入与更新的完整同步


**场景**：完整的数据同步操作，既要更新匹配的记录，也要插入新的记录


**建表语句**


```sql
-- 目标表：数据记录
CREATE TABLE data_sync_target (
  id INT,
  col1 STRING,
  col2 STRING
);


-- 源表：新数据
CREATE TABLE data_sync_source (
  id INT,
  col1 STRING,
  col2 STRING
);
```




**初始目标表数据：**
```sql
INSERT INTO data_sync_target VALUES 
(1, 'data_a', 'value_a'),
(2, 'data_b', 'value_b'),
(3, 'data_c', 'value_c');
```

```
+----+--------+---------+
| id | col1   | col2    |
+----+--------+---------+
| 1  | data_a | value_a |
+----+--------+---------+
| 2  | data_b | value_b |
+----+--------+---------+
| 3  | data_c | value_c |
+----+--------+---------+
```


**初始源表数据：**
```sql
INSERT INTO data_sync_source VALUES 
(1, 'updated_a', 'updated_value_a'),
(2, 'updated_b', 'updated_value_b'),
(4, 'new_data', 'new_value'),
(5, 'new_data2', 'new_value2');
```

```
+----+----------+------------------+
| id | col1     | col2             |
+----+----------+------------------+
| 1  | updated_a| updated_value_a  |
+----+----------+------------------+
| 2  | updated_b| updated_value_b  |
+----+----------+------------------+
| 4  | new_data | new_value        |
+----+----------+------------------+
| 5  | new_data2| new_value2       |
+----+----------+------------------+
```


**MERGE SQL**


```sql
MERGE INTO data_sync_target t USING data_sync_source s
ON t.id = s.id
WHEN MATCHED THEN UPDATE SET t.col1 = s.col1, t.col2 = s.col2
WHEN NOT MATCHED THEN INSERT (id, col1, col2) VALUES (s.id, s.col1, s.col2);
```


**执行结果**


```
+----+----------+------------------+
| id | col1     | col2             |
+----+----------+------------------+
| 1  | updated_a| updated_value_a  |
+----+----------+------------------+
| 2  | updated_b| updated_value_b  |
+----+----------+------------------+
| 3  | data_c   | value_c          |
+----+----------+------------------+
| 4  | new_data | new_value        |
+----+----------+------------------+
| 5  | new_data2| new_value2       |
+----+----------+------------------+
```


**说明**：
- **id=1, 2**：源表中存在匹配记录，执行 UPDATE 操作，col1 和 col2 都被更新为源表的值
- **id=3**：源表中没有对应记录，保持原值不变
- **id=4, 5**：源表新增的记录，执行 INSERT 操作，插入到目标表中