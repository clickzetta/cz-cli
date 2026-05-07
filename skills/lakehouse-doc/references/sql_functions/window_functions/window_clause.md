### 窗口函数概述

窗口函数是 SQL 中一种强大的分析工具，它允许您在一组相关行上执行计算，而不仅仅是针对单个行。窗口函数通过创建一个“窗口”来查看当前行及其上下文行，从而实现复杂的数据分析任务。

#### 语法

```sql
function_name([expr [, ...]]) OVER ( [window_definition] )
```

* `function_name`: 内置的窗口函数，如 `SUM`、`COUNT` 等。
* `expr`: 函数参数，根据实际数据确定。
* `window_definition`: 窗口定义，用于指定如何在数据集上应用窗口函数。

#### 窗口定义

```sql
[PARTITION BY expression [, ...]]
[ORDER BY expression [ASC|DESC]] [, ...]
[FRAME frame_clause]
```

* `PARTITION BY` 子句: 可选，用于将数据集划分为不同的分区。
* `ORDER BY` 子句: 可选，用于指定数据在每个窗口内的排序方式。建议使用唯一的列或列组合来减少随机性。
* `FRAME` 子句: 可选，用于确定窗口的边界。具体描述如下。

#### FRAME 子句

```sql
{ROWS|RANGE} BETWEEN frame_start AND frame_end
```

`FRAME` 子句定义了一个闭区间，用于确定数据边界。`ROWS` 和 `RANGE` 是两种类型的边界类型。

* `ROWS` 类型: 通过数据行号确定边界。
* `RANGE` 类型: 当指定了 `ORDER BY` 时，使用列值的大小关系来确定边界。未指定 `ORDER BY` 时，所有行被认为具有相同的值。

`frame_start` 和 `frame_end` 表示窗口的起始和终止边界。`frame_start` 是必填的，`frame_end` 可选，默认值为 `CURRENT ROW`。具体选项如下：

- `UNBOUNDED PRECEDING`: 表示分区或结果集的开始。
- `OFFSET PRECEDING`: 表示相对于当前行的偏移量。
- `CURRENT ROW`: 仅表示当前行。
- `OFFSET FOLLOWING`: 表示相对于当前行之后的偏移量。
- `UNBOUNDED FOLLOWING`: 表示分区或结果集的结束。

在没有显式设置 `FRAME` 子句时，默认的 `FRAME` 子句为：

```sql
RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
```

#### 使用示例

```sql
SELECT
  name,
  dep_no,
  salary,
  COUNT(salary) OVER (PARTITION BY dep_no ORDER BY salary ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) rows_up_uf,
  COUNT(salary) OVER (PARTITION BY dep_no ORDER BY salary RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) range_up_uf,
  COUNT(salary) OVER (PARTITION BY dep_no ORDER BY salary ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) rows_up_cr,
  COUNT(salary) OVER (PARTITION BY dep_no ORDER BY salary RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) range_up_cr,
  COUNT(salary) OVER (PARTITION BY dep_no ORDER BY salary ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) rows_cr_uf,
  COUNT(salary) OVER (PARTITION BY dep_no ORDER BY salary RANGE BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) range_cr_uf,
  COUNT(salary) OVER (PARTITION BY dep_no ORDER BY salary ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) rows_1p_1f
FROM VALUES
  ('Eric', 1, 28000),
  ('Alex', 1, 32000),
  ('Felix', 2, 21000),
  ('Frank', 1, 30000),
  ('Lily', 2, 23000),
  ('Jane', 3, 29000),
  ('Jeff', 3, 35000),
  ('Paul', 2, 29000),
  ('Charles', 2, 23000)
  AS tab(name, dep_no, salary);
```

#### 窗口函数分类

窗口函数根据其行为可以分为以下三类：

1. 排名函数（ranking_function）：用于计算排名，必须指定 `ORDER BY`，不能指定 `FRAME` 子句。例如：
   - `ROW_NUMBER`
   - `RANK`
   - `DENSE_RANK`
   - `PERCENT_RANK`
   - `NTILE`
2. 分析函数（analytic_function）：用于执行更复杂的分析计算。例如：
   - `CUME_DIST`
   - `