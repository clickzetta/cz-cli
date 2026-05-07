### MONOTONICALLY_INCREASING_ID
```sql
monotonically_increasing_id()
```
#### 功能
生成单调递增的 ID。该函数为每一行生成一个唯一的、单调递增的 64 位整数 ID。在分布式环境中，每个分区生成的 ID 范围不重叠，确保全局唯一性。

#### 参数
* 无参数

#### 返回结果
* bigint 类型
* 返回单调递增的唯一 ID
* ID 从 0 开始递增
* 在分布式环境中，不同分区的 ID 不重叠

#### 举例
```sql
-- 基本用法
> SELECT a, monotonically_increasing_id() as id
  FROM VALUES (1), (2), (3), (4), (5) AS t(a);
1	0
2	1
3	2
4	3
5	4

-- 在分布式环境中使用
> SELECT a, monotonically_increasing_id() as id
  FROM VALUES (1), (2), (3), (4), (5), (6), (7), (8), (9), (10) AS t(a)
  DISTRIBUTE BY a;
1	8589934592
2	17179869184
3	0
4	8589934593
5	17179869185
6	8589934594
7	0
8	8589934595
9	17179869186
10	8589934596

-- 生成唯一的行号
> SELECT monotonically_increasing_id() as row_id, *
  FROM large_table;

-- 为数据添加序列号
> SELECT monotonically_increasing_id() as seq, name, age
  FROM users
  ORDER BY age;
```

#### 说明
* monotonically_increasing_id 生成的 ID 具有以下特性：
  * 唯一性：每个 ID 在结果集中唯一
  * 单调性：ID 值单调递增（但不一定连续）
  * 确定性：在相同的数据分布下，生成的 ID 相同
* 在分布式环境中，ID 的生成方式：
  * 每个分区分配一个 ID 范围
  * 分区内的 ID 连续递增
  * 不同分区的 ID 范围不重叠
  * ID 的高位用于标识分区，低位用于标识分区内的行号
* ID 的构成（64 位）：
  * 高 33 位：分区 ID
  * 低 31 位：分区内的行号
  * 因此，每个分区最多可以有 2^31 - 1 行
* 与 row_number() 的区别：
  * monotonically_increasing_id() 在分布式环境中更高效
  * row_number() 需要全局排序，开销较大
  * monotonically_increasing_id() 不保证连续性
* 注意事项：
  * ID 不一定从 0 开始（在分布式环境中）
  * ID 之间可能有间隙
  * 不应依赖 ID 的具体值，只能依赖其唯一性和单调性
  * 相同的查询在不同的执行中可能生成不同的 ID（如果数据分布改变）
* 该函数常用于：
  * 为表中的行生成唯一标识符
  * 数据导出时添加序列号
  * 临时表的主键生成
  * 数据分区和分桶
* 如需生成连续的行号，请使用 row_number() 窗口函数
