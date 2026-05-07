函数名称：ARRAY_SORT_BY_KEY

功能描述：
ARRAY_SORT_BY_KEY 函数用于对数组进行排序。根据提供的 lambda 表达式，该函数可以依据数组元素的某个属性进行排序。

参数说明：
* array：待排序的数组，类型为 `array<T>`，其中 T 可以是任意支持排序的数据类型。
* `e -> key`：一个 lambda 表达式，用于从数组元素 `e` 中提取排序依据的键值。该表达式应当返回一个可排序的数据类型。

返回值：
返回一个新的、已根据指定键值排序的数组，类型为 `array<T>`。

使用示例：
```sql
-- 示例 1: 对日期数组按照月份进行排序
SELECT ARRAY_SORT_BY_KEY(
  ARRAY(
    DATE '2023-10-10',
    DATE '2021-01-10',
    DATE '2022-03-10',
    DATE '2022-02-10',
    DATE '2020-09-10',
    DATE '2023-11-10'
  ),
  x -> MONTH(x)
);
-- 结果：[DATE '2021-01-10', DATE '2022-02-10', DATE '2022-03-10', DATE '2020-09-10', DATE '2023-10-10', DATE '2023-11-10']

-- 示例 2: 对字符串数组按照字符串长度进行排序
SELECT ARRAY_SORT_BY_KEY(
  ARRAY(
    'apple',
    'banana',
    'cherry',
    'date'
  ),
  x -> LENGTH(x)
);
-- 结果：['date', 'apple', 'banana', 'cherry']



