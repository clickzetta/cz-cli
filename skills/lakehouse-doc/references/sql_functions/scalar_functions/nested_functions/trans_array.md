# TRANS\_ARRAY 函数

## 函数描述

`TRANS_ARRAY` 是一个用户自定义表值函数（UDTF），用于将一行数据转换为多行数据。它将列中存储的以固定分隔符格式分隔的数组转换为多行，实现"行转列"的数据变换。该函数特别适合处理那些将多个值存储在单个字符串字段中的数据结构。

### 核心特性

* **行转列转换**：将单行中用分隔符分隔的多个值拆分为多行
* **灵活的 Key 列**：支持指定一个或多个列作为 Key，这些列不参与拆分
* **自动补全**：当数组长度不相等时，自动用 NULL 填充较短的数组
* **分隔符可配置**：支持任意字符串作为分隔符

## 语法

```sql
trans_array(<num_keys>, <separator>, <key1>, <key2>, ..., <col1>, <col2>, <col3>)AS (<key1>, <key2>, ..., <col1>, <col2>)
```

## 参数说明

| 参数              | 类型     | 必填 | 说明                                                              |
| ----------------- | -------- | ---- | --------------------------------------------------------------- |
| num\_keys         | BIGINT   | 是   | 转置时作为 Key 的列的个数。必须为常量，值必须 ≥ 0。Key 列必须位于所有待转置列之前。                 |
| separator         | STRING   | 是   | 用于将字符串拆分成多个元素的分隔符。必须为常量，不能为空字符串，否则返回错误。                          |
| key1, key2, ...   | 任意类型 | 是   | 转置时作为 Key 的列，个数由 num\_keys 指定。Key 列在结果中保持原有数据类型。                 |
| col1, col2, ...   | STRING   | 是   | 要转为行的数组列。这些列必须为 STRING 类型，存储的内容是字符串格式的数组，例如 `item1;item2;item3`。 |

### 特殊说明

* **Key 列的作用**：Key 列用于分组和标识，拆分过程中 Key 列的值保持不变

* **转置列要求**：Key 之后的所有列都视为待转置的数组列，必须为 STRING 类型

* **输出行数**：以长度最长的数组为准，其他较短数组不足的位置用 NULL 填充。

* **输出类型**：Key 列保持原有类型，其余所有列为 STRING 类型


## 返回值

返回转置后的多行数据，其中：

* Key 列的数据类型保持不变
* 转置后的列全部为 STRING 类型
* 新的列名由 AS 子句指定

## 使用示例

**示例 1：单 Key 的基础转置**

场景描述：用户登录表中，每个用户有多条登录 IP 和时间信息，存储为用分隔符分隔的字符串。需要将其拆分为多行以便于分析。

原始数据表：`test_user_login`

```
CREATE TABLE test_user_login ( login_id STRING, login_ip STRING, login_time STRING);
INSERT INTO test_user_login VALUES('wangwangA', '192.168.0.1,192.168.0.2', '20120101010000,20120102010000'),('wangwangB', '192.168.45.10,192.168.67.22,192.168.6.3', '20120111010000,20120112010000,20120223080000');
```

SQL 语句：

```sql
SELECT  trans_array(1, ',', login_id, login_ip, login_time)  AS (login_id, login_ip, login_time)FROM test_user_login;
```

执行结果：

| login\_id | login\_ip     | login\_time    |
| --------- | ------------- | -------------- |
| wangwangA | 192.168.0.1   | 20120101010000 |
| wangwangA | 192.168.0.2   | 20120102010000 |
| wangwangB | 192.168.45.10 | 20120111010000 |
| wangwangB | 192.168.67.22 | 20120112010000 |
| wangwangB | 192.168.6.3   | 20120223080000 |

结果说明：

* `num_keys=1` 表示只有 `login_id` 列作为 Key。
* `separator=','` 指定逗号作为分隔符。
* 每个用户的登录记录被拆分为单独的行。
* `login_id` 保持不变，作为分组标识。

**示例 2：多 Key 的转置**

场景描述：用户信息表中包含用户 ID、姓名以及多条登录 IP 和时间记录。现需使用两个 Key 列进行转置。

原始数据表：`test_user_info`

```
CREATE TABLE test_user_info ( id INT, name STRING, login\_ip STRING, login\_time STRING);
INSERT INTO test_user_info VALUES(1, 'Tom', '192.168.100.1,192.168.100.2', '20211101010101,20211101010102'),(2, 'Jerry', '192.168.100.3,192.168.100.4', '20211101010103,20211101010104');
```

SQL 语句：

```sql
SELECT  trans_array(2, ',', id, name, login_ip, login_time)  AS (id, name, login_ip, login_time)FROM test_user_info;
```

执行结果：

| id | name  | login\_ip     | login\_time    |
| -- | ----- | ------------- | -------------- |
| 1  | Tom   | 192.168.100.1 | 20211101010101 |
| 1  | Tom   | 192.168.100.2 | 20211101010102 |
| 2  | Jerry | 192.168.100.3 | 20211101010103 |
| 2  | Jerry | 192.168.100.4 | 20211101010104 |

结果说明：

* `num_keys=2` 表示将 `id` 和 `name` 两列作为 Key。
* 两个 Key 列在结果中保持不变。
* 登录记录根据 Key 列的值保持分组关系。

**示例 3：不等长数组处理（自动补 NULL）**

场景描述：用户兴趣表中，不同用户拥有不同数量的爱好和运动项目。本示例展示如何处理数组长度不相等的情况。

原始数据表：`test_unequal_array`

```
CREATE TABLE test_unequal_array ( user_id STRING, hobbies STRING, sports STRING);
INSERT INTO test_unequal_array VALUES('user1', 'reading,coding', 'basketball,tennis,swimming');

```

SQL 语句：

```sql
SELECT  trans_array(1, ',', user_id, hobbies, sports)  AS (user_id, hobbies, sports)FROM test_unequal_array;
```

执行结果：

| user\_id | hobbies | sports     |
| -------- | ------- | ---------- |
| user1    | reading | basketball |
| user1    | coding  | tennis     |
| user1    | NULL    | swimming   |

结果说明：

* `hobbies` 列有 2 个元素，`sports` 列有 3 个元素。
* 输出行数以较长数组（3 行）为准。
* `hobbies` 列的第三行用 NULL 填充。
* 这种自动补全机制避免了数据丢失。
