# 自增列IDENTITY

Lakehouse支持在建表时标识列，将字段定义为自增字段。

配置自增序列。如下建表语句使用自增列，仅支持bigint类型：

```Plain
CREATE TABLE tablename (
    id bigint identity
);
```

## 语法

```SQL
IDENTITY[(seed)]
```

* seed：用于指定表中第一行的起始值。如果不指定，默认起始值为0。

## 行为说明

* 无法保证序列中的值是连续的（无间隙），也无法保证序列值按特定顺序分配，因为表中可能会发生并发插入。这些限制是设计的一部分，目的是提高性能，并且在许多常见情况下都是可以接受的。

## 使用示例

```SQL
--创建表，包含id和col两个字段。
CREATE TABLE identity_test
(
    id bigint identity (1),
    col string
);

--在insert语句中，给col字段插入数据。
INSERT INTO identity_test (col)
VALUES ('1'),('2'),('3'),('4'),('5');
--查询数据
SELECT * FROM identity_test;
+----+-----+
| id | col |
+----+-----+
| 1  | 1   |
| 2  | 2   |
| 3  | 3   |
| 4  | 4   |
| 5  | 5   |
+----+-----+
--再插入一条数据，无法保证自增连续性
INSERT INTO identity_test (col)
VALUES ('6');
+----+-----+
| id | col |
+----+-----+
| 11 | 6   |
| 1  | 1   |
| 2  | 2   |
| 3  | 3   |
| 4  | 4   |
| 5  | 5   |
+----+-----+
--查看是否含有自增列
SHOW CREATE TABLE identity_test;
```

# 限制与约束

* 暂不支持通过Ingest Service流式接口写入，仅在SQL语法层面支持IDENTITY列的写入。
* 不支持指定步长，默认步长是1。
* 不支持通过ALTER语句在已有表中添加自增列。
* 不支持为外部表、动态表和物化视图设置自增列。
* 只支持bigint类型。


