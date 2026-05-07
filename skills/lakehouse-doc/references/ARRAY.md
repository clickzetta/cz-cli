# ARRAY
`ARRAY`是一种数据类型，用于表示由同一种类型的元素序列构成的值。这种数据类型可以存储一系列具有相同数据类型的元素，方便进行统一管理和操作。

## 语法

```sql
ARRAY <elementType>
```
- `elementType`：指定数组中元素的数据类型。

## ARRAY常量格式
```
select [1,3,4];
```
这种格式表示一个数组常量。请确保在定义数组常量时**不使用引号**，因为引号会使其被识别为字符串类型，而字符串类型的`'[1,3,4]'`不能直接被使用 `CAST` 转化成`array<int>`类型。

## 示例

1. 创建一个整数数组：

```sql
SELECT ARRAY(1, 2, 3);
```
执行结果：
| result    |
| --------- |
| [1, 2, 3] |

2. 将整数数组转换为字符串数组：

```sql
SELECT CAST(ARRAY(1, 2, 3) AS ARRAY<STRING>);
```
执行结果：
| result          |
| --------------- |
| ["1", "2", "3"] |

3. 获取数组元素的数据类型：

```sql
SELECT typeof(ARRAY(1.2, 1.4, 1.8));
```
执行结果：
| result              |
| ------------------- |
| array<decimal(2,1)> |

4. 创建一个嵌套数组（数组中包含其他数组）：

```sql
SELECT CAST(ARRAY(ARRAY(10, 20), ARRAY(30, 40)) AS ARRAY<ARRAY<DECIMAL(10,2)>>);
```
执行结果：
| result                           |
| -------------------------------- |
| [[10.00, 20.00], [30.00, 40.00]] |

5. 获取数组中的特定元素：

```sql
SELECT a[0] FROM VALUES(ARRAY(10, 20, 30)) AS T(a);
```
执行结果：
| result |
| ------ |
| 10     |

6. 使用`ARRY_CONTAINS`检查数组中是否存在特定元素：

```sql
SELECT array_contains(ARRAY(1, 2, 3),3);
```
执行结果：
| Result |
| ------ |
| true   |

7. 对数组进行排序：

```sql
SELECT ARRAY_SORT(array(2, 1, 3));
```
执行结果：
| result    |
| --------- |
| [1, 2, 3] |

8. 合并两个数组：

```sql
SELECT array_union(array(2, 1, 3, 3), array(3, 5));
```
执行结果：
| result    |
| --------- |
| [2,1,3,5] |


