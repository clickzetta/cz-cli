# 功能

`table_changes` 是一个用于查询 Lakehouse 表、动态表和物化视图的数据变化的表函数。通过指定一个时间区间，该函数可以返回该区间内的数据变化，无需创建表流。使用 `table_changes` 时需要确保已开启 `change_tracking` 功能。请在表上执行 `ALTER TABLE tbname SET PROPERTIES ('change_tracking'='true');` 来开启。是否可以查看的对象操作历史依赖于数据的保留周期。数据保留周期默认为七天。

# 语法

```SQL
TABLE_CHANGES(table_str, start_timestamp, end_timestamp)
```

**参数要求**：

* `table_str`：已存在的表、动态表或物化视图名称，需提供字符串格式。支持 'schema.tbname'、'tbname' 格式字符串。若未指定 schema，则默认使用当前 schema，即 `current_schema`。
* `start_timestamp`：查询的时间版本起始时间，需提供标准时间戳类型表达式。
* `end_timestamp`：查询的时间版本结束时间，需提供标准时间戳类型表达式。
* opitons:可选参数，目前支持map('TABLE\_STREAM\_MODE', 'ORIGINAL')。当添加此参数时表示获取表变化的原始记录，未添加此参数时比如在start\_timestamp、end\_timestamp之间先insert一条记录再delete这条记录，不添加此参数将会查询不到，如果添加ORIGINAL参数则会显示insert记录和delete记录

**说明**：

* 指定的 `start_timestamp` 不能早于表创建时间，也不能超出数据保留周期。
* `start_timestamp` 和 `end_timestamp` 分别表示查询的起始和结束时间。查询结果不包括 `start_timestamp` 那一刻的数据，但包括 `end_timestamp` 那一刻的数据。查询时间区间为 (start\_timestamp, end\_timestamp]，左边为开区间，右边为闭区间。

# 示例

示例一：查看表变化

```SQL
-- 创建表
CREATE TABLE students_change(name STRING, class STRING) PARTITIONED BY (class);
-- 开启 change_tracking
ALTER TABLE students_change SET PROPERTIES ('change_tracking'='true');
-- 插入数据
INSERT INTO students_change (name, class) VALUES
('Alice', 'A'),
('Bob', 'B'),
('Carol', 'A'),
('David', 'C');
-- 插入数据
INSERT INTO students_change (name, class) VALUES ('person', 'c');
-- 查看历史版本
DESC HISTORY students_change;
+---------+-------------------------+------------+-------------+----------+-------------+-------------------------------+
| version |          time           | total_rows | total_bytes |   user   |  operation  |            job_id             |
+---------+-------------------------+------------+-------------+----------+-------------+-------------------------------+
| 7       | 2024-02-01 17:53:42.945 | 4          | 7640        | UAT_TEST | INSERT_INTO | 202402010953426415k3g3xp367p7 |
| 6       | 2024-01-29 11:15:41.396 | 3          | 5087        | N/A      |             |                               |
+---------+-------------------------+------------+-------------+----------+-------------+-------------------------------+
-- 查看两个版本的数据变化
SELECT * FROM TABLE_CHANGES('students_change', TIMESTAMP '2024-01-29 11:15:41.396', TIMESTAMP '2024-02-01 17:53:42.945');
+---------------+------------------+-------------------------+------+--------+-------+
| __change_type | __commit_version |   __commit_timestamp    | col1 |  name  | class |
+---------------+------------------+-------------------------+------+--------+-------+
| INSERT        | 7                | 2024-02-01 17:53:42.945 | null | person | c     |
+---------------+------------------+-------------------------+------+--------+-------+
```

示例二：查看动态表变化

```SQL
-- 创建测试表，存储员工信息
CREATE TABLE customer(id INT, name STRING, phone BIGINT, email STRING);
-- 插入数据
INSERT INTO customer VALUES
(1, 'Alice', 1234567890, 'alice@example.com'),
(2, 'Bob', 2345678901, 'bob@example.com'),
(3, 'Carol', 3456789012, 'carol@example.com'),
(4, 'Dave', 4567890123, 'dave@example.com'),
(5, 'Eve', 5678901234, 'eve@example.com');
-- 创建动态表处理数据
CREATE DYNAMIC TABLE customer_masked AS
SELECT id, name, MASK_OUTER(phone, 3, 4) AS phone, MASK_INNER(email, 0, 12) AS email
FROM customer;
-- 开启 change_tracking
ALTER TABLE customer_masked SET PROPERTIES ('change_tracking'='true');
-- 刷新动态表
REFRESH DYNAMIC TABLE customer_masked;
-- 向基表插入数据
INSERT INTO customer VALUES
(6, 'Alaac', 1234567890, 'alabcce@example.com');
-- 刷新动态表
REFRESH DYNAMIC TABLE customer_masked;
-- 查看历史版本
DESC HISTORY customer_masked;
-- 查看动态表的数据变化，可以看到新增了一条记录
SELECT * FROM TABLE_CHANGES('customer_masked', TIMESTAMP '2024-01-24 20:14:19.726', TIMESTAMP '2024-01-24 20:55:43.049');
+---------------+------------------+-------------------------+----+-------+------------+---------------------+
| __change_type | __commit_version |   __commit_timestamp    | id | name  |   phone    |        email        |
+---------------+------------------+-------------------------+----+-------+------------+---------------------+
| INSERT        | 4                | 2024-01-24 20:55:43.049 | 6  | Alaac | XXX456XXXX | XXXXXXX@example.com |
+---------------+------------------+-------------------------+----+-------+------------+---------------------+
```

示例三：显示原始记录

```SQL
-- 创建表
CREATE TABLE students_change(name STRING, class STRING) PARTITIONED BY (class);
-- 开启 change_tracking
ALTER TABLE students_change SET PROPERTIES ('change_tracking'='true');
-- 插入数据
INSERT INTO students_change (name, class) VALUES
('Alice', 'A'),
('Bob', 'B'),
('Carol', 'A'),
('David', 'C');
-- 更新数据
UPDATE students_change SET class = lower(class) WHERE name='Alice'; 
UPDATE students_change SET class = lower(class) WHERE name='Alice'; 
DELETE FROM students_change WHERE name = 'Alice';
--显示原始记录
select * from table_changes('students_change',timestamp '2024-09-29 20:03:50.58',current_timestamp(),map('TABLE_STREAM_MODE', 'ORIGINAL'));
+---------------+------------------+-------------------------+-------+-------+
| __change_type | __commit_version |   __commit_timestamp    | name  | class |
+---------------+------------------+-------------------------+-------+-------+
| UPDATE_BEFORE | 3                | 2024-09-29 20:03:50.399 | Alice | A     |
| UPDATE_AFTER  | 5                | 2024-09-29 20:05:16.443 | Alice | a     |
| UPDATE_BEFORE | 5                | 2024-09-29 20:05:16.443 | Alice | a     |
| UPDATE_AFTER  | 6                | 2024-09-29 20:05:46.118 | Alice | a     |
| DELETE        | 6                | 2024-09-29 20:05:46.118 | Alice | a     |
+---------------+------------------+-------------------------+-------+-------+
--显示压缩后的记录
select * from table_changes('students_change',timestamp '2024-09-29 20:03:50.58',current_timestamp());
+---------------+------------------+-------------------------+-------+-------+
| __change_type | __commit_version |   __commit_timestamp    | name  | class |
+---------------+------------------+-------------------------+-------+-------+
| DELETE        | 3                | 2024-09-29 20:03:50.399 | Alice | A     |
+---------------+------------------+-------------------------+-------+-------+
```

# 注意事项

1. 使用 `table_changes` 函数时，请确保已开启 `change_tracking` 功能。
2. 指定的 `start_timestamp` 不能早于表创建时间，也不能超出数据保留周期。
3. 查询结果不包括 `start_timestamp` 那一刻的数据，但包括 `end_timestamp` 那一刻的数据。

^
