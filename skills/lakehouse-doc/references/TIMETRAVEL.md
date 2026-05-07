# Lakehouse Time Travel功能简介

Lakehouse的Time Travel功能允许用户在定义的时间段内的任何时间点访问历史数据，包括已更改或删除的数据。Lakehouse Time Travel功能收取存储费用，并将默认保留周期为一天。请注意，如果设置的时间更长，存储费用会增加。

## 应用场景

1. 恢复可能被意外或有意删除的数据。
2. 复制和备份过去关键点的数据。
3. 分析指定时间段内的数据变化。
## Time Travel保留期限设置

Time Travel保留期限决定了您可以访问多久以前的数据。例如，如果Time Travel保留期限设置为7天，那么您可以访问过去7天内的任何时间点的数据。超过7天后，您将无法使用Time Travel访问过期的数据，且数据会被物理删除。
Lakehouse表的历史状态默认保留周期1天（24小时），您可以通过Time Travel查询1天内的历史版本。

如需保留更长周期的历史版本，您可以为每个表设置不同的数据保留周期，以满足不同的业务需求。num的设置范围为0-90。

  * ```SQL
    ALTER TABLE tablename SET PROPERTIES ('data_retention_days'='num');
    ```
## TIMETRAVEL查询语法

```sql
SELECT 
    table_identifier TIMESTAMP AS OF timestamp_expression
```

通过使用TIMESTAMP AS OF子句，用户可以指定具体的时间点，查询保留期内表历史记录中指定点的精确位置或紧邻指定点之前的数据。Timestamp\_expression是一个返回时间戳类型表达式的参数，例如：

* `'2023-11-07 14:49:18'`，即可强制转换为时间戳的字符串。
* `CAST('2023-11-07 14:49:18' AS TIMESTAMP)`。
* `CURRENT_TIMESTAMP() - INTERVAL 12 HOURS`。12小时之前的版本
* 任何本身是时间戳类型或可强制转换为时间戳的表达式。

## 查询说明

* 通过指定时间点，用户可以查询到指定时间的版本数据。
* 查询的时间点不能早于表创建时间，也不能超出数据保留周期。如果指定的时间点超出范围，将报错。
* 如果timestamp\_expression是未来时间，也会报错，因为未来的数据是不可用的。

## 权限要求

* 用户需要拥有对表的SELECT权限。

## 使用限制

* View不支持Time Travel查询。
* 不支持外部schema。
* RealtimeStream实时写入未提交的数据不支持Time Travel查询，因为RealtimeStream为了提供实时查询功能，会优先写入到临时区，方便快速查询。而Time Travel查询历史版本是依靠查询提交记录，因此暂时无法查询RealtimeStream实时写入未提交的数据。

## 具体案例

### 分析指定时间段内的数据

```sql
CREATE TABLE birds (
    id INT,
    name VARCHAR(50),
    wingspan_cm FLOAT,
    colors STRING
);

INSERT INTO birds (id, name, wingspan_cm, colors) VALUES
    (1, 'Sparrow', 15.5, 'Brown'),
    (2, 'Blue Jay', 20.2, 'Blue'),
    (3, 'Cardinal', 22.1, 'Red'),
    (4, 'Robin', 18.7, 'Red","Brown');

-- 插入更多数据
INSERT INTO birds (id, name, wingspan_cm, colors) VALUES
    (5, 'Hummingbird', 8.2, 'Green'),
    (6, 'Penguin', 99.5, 'Black", "White'),
    (7, 'Eagle', 200.8, 'Brown'),
    (8, 'Owl', 105.3, 'Gray'),
    (9, 'Flamingo', 150.6, 'Pink'),
    (10, 'Pelican', 180.4, 'White');
--查看版本
DESC HISTORY birds;
+---------+-------------------------+------------+-------------+----------+----+
| version |          time           | total_rows | total_bytes |   user   |  o |
+---------+-------------------------+------------+-------------+----------+----+
| 3       | 2024-12-23 16:41:47.831 | 10         | 5786        | UAT_TEST | IN |
| 2       | 2024-12-23 16:36:04.426 | 4          | 2859        | UAT_TEST | IN |
| 1       | 2024-12-23 16:36:04.233 | 0          | 0           | UAT_TEST | CR |
+---------+-------------------------+------------+-------------+----------+----+
-- 等待五分钟后查询
SELECT * FROM birds TIMESTAMP AS OF timestamp'2024-12-23 16:36:04.426';
+----+----------+-------------+-------------+
| id |   name   | wingspan_cm |   colors    |
+----+----------+-------------+-------------+
| 1  | Sparrow  | 15.5        | Brown       |
| 2  | Blue Jay | 20.2        | Blue        |
| 3  | Cardinal | 22.1        | Red         |
| 4  | Robin    | 18.7        | Red","Brown |
+----+----------+-------------+-------------+
```

### 指定版本的数据和其他表做join

```
DROP TABLE students;
DROP TABLE scores;
CREATE TABLE students (name string, class string);
INSERT INTO students (name, class) VALUES
('Alice', 'A'),
('Bob', 'B');
CREATE TABLE scores (name string, score int);
INSERT INTO scores (name, score) VALUES
('Alice', 90),
('Bob', 80),
('Carol', 85),
('David', 95);

--等待1分钟插入
INSERT INTO students (name, class) VALUES
('Carol', 'A'),
('David', 'C');
--查看版本
DESC HISTORY  students;
+---------+-------------------------+------------+-------------+----------+----+
| version |          time           | total_rows | total_bytes |   user   |  o |
+---------+-------------------------+------------+-------------+----------+----+
| 3       | 2024-12-23 16:17:01.792 | 4          | 3884        | UAT_TEST | IN |
| 2       | 2024-12-23 16:15:22.957 | 2          | 1939        | UAT_TEST | IN |
| 1       | 2024-12-23 16:15:22.829 | 0          | 0           | UAT_TEST | CR |
+---------+-------------------------+------------+-------------+----------+----+
--当前版本查询
SELECT students.name, students.class, scores.score
FROM students 
INNER JOIN scores
ON students.name = scores.name;
+-------+-------+-------+
| name  | class | score |
+-------+-------+-------+
| Carol | A     | 85    |
| Bob   | B     | 80    |
| David | C     | 95    |
| Alice | A     | 90    |
+-------+-------+-------+
--使用students 2024-12-23 16:15:22.957的版本
SELECT students.name, students.class, scores.score
FROM students timestamp as of '2024-12-23 16:15:22.957'
INNER JOIN scores
ON students.name = scores.name;
+-------+-------+-------+
| name  | class | score |
+-------+-------+-------+
| Alice | A     | 90    |
| Bob   | B     | 80    |
+-------+-------+-------+

```

### 恢复可能被意外或有意删除的数据

模拟删除数据：

```sql
CREATE TABLE birds (
    id INT,
    name VARCHAR(50),
    wingspan_cm FLOAT,
    colors STRING
);

INSERT INTO birds (id, name, wingspan_cm, colors) VALUES
    (1, 'Sparrow', 15.5, 'Brown'),
    (2, 'Blue Jay', 20.2, 'Blue'),
    (3, 'Cardinal', 22.1, 'Red'),
    (4, 'Robin', 18.7, 'Red","Brown');

-- 删除数据
TRUNCATE TABLE birds;

-- 查看数据是否还存在
SELECT * FROM birds; -- 数据已经被删除
```

运行历史查看truncate时间：

![truncate\_time](.topwrite/assets/image_1699363617476.png)

恢复数据：

```sql
-- 查看删除之前的数据，根据上面运行历史执行的时间，设置time travel版本
SELECT * FROM birds TIMESTAMP AS OF '2023-11-07 14:49:18';

-- 恢复数据
INSERT OVERWRITE TABLE birds
SELECT * FROM birds TIMESTAMP AS OF '2023-11-07 14:49:18';
```

## 复制和备份过去关键点的数据。

可以将指定时间点的数据备份到另一张表中

```
CREATE    TABLE birds_backup AS
SELECT    *
FROM      birds TIMESTAMP AS OF '2023-11-20 15:48:40';

SELECT    *
FROM      birds_backup;

```


