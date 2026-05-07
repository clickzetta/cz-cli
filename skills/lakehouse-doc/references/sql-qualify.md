# QUALIFY

## 功能介绍

QUALIFY 子句用于在 SELECT 语句中对窗口函数的结果进行过滤。QUALIFY 对窗口函数的作用就像 HAVING 对聚合函数和 GROUP BY 子句的作用一样。在查询的执行顺序中，QUALIFY 在窗口函数计算之后进行评估。

QUALIFY 能够简化需要对窗口函数结果进行过滤的查询，无需使用子查询嵌套。这大大提高了 SQL 语句的可读性和简洁性。

### QUALIFY 的执行顺序

SELECT 语句中各子句的典型执行顺序如下：

1. FROM
2. WHERE
3. GROUP BY
4. HAVING
5. Window Functions（窗口函数）
6. **QUALIFY** ⭐
7. DISTINCT
8. ORDER BY
9. LIMIT



## 语法结构

```sql
SELECT <column_list>, <window_function> AS <alias>
FROM <data_source>
[WHERE ...]
[GROUP BY ...]
[HAVING ...]
QUALIFY <predicate>
[ORDER BY ...]
[LIMIT ...]
```

### 参数说明

* **column_list**：SELECT 子句中指定的列列表
* **window_function**：窗口函数表达式，需要给定别名以便在 QUALIFY 子句中引用
* **alias**：窗口函数的别名，在 QUALIFY 子句的谓词中使用
* **data\_source**：数据源，通常是表
* **predicate**：用于过滤的谓词表达式，使用窗口函数的别名



## 使用说明

### 必要条件

QUALIFY 子句要求在 SELECT 语句中指定窗口函数并为其给定别名

### 关键特性

* 在 SELECT 子句中定义窗口函数时，**必须给定别名**
* 在 QUALIFY 子句中使用该别名进行条件判断
* 支持所有标准的窗口函数
* 支持各种比较运算符（=, !=, <, >, <=, >=, IN 等）
* QUALIFY 是保留字



## 使用示例

### 示例 1：获取每个分组的第一条记录

**场景说明**：使用 ROW_NUMBER 获取每个分组中序号为 1 的记录

**测试表**：

```sql
CREATE TABLE qualify_test (
    i INT,
    p CHAR(1),
    o INT
);

INSERT INTO qualify_test VALUES 
(1, 'A', 1),
(2, 'A', 2),
(3, 'B', 1),
(4, 'B', 2);
```

**SQL 语句**：

```sql
SELECT i, p, o, ROW_NUMBER() OVER (PARTITION BY p ORDER BY o) as flag
FROM qualify_test 
QUALIFY flag = 1;
```

```
i | p | o | flag
--|---|---|-----
1 | A | 1 |  1
3 | B | 1 |  1
```



### 示例 2：获取排序号大于 1 的记录

**SQL 语句**：

```sql
SELECT i, p, o, ROW_NUMBER() OVER (PARTITION BY p ORDER BY o) as row_num
FROM qualify_test 
QUALIFY row_num > 1;
```

**执行结果**：

```
i | p | o | row_num
--|---|---|--------
2 | A | 2 |   2
4 | B | 2 |   2
```





### 示例 3：使用 RANK 函数获取排名前 2

**SQL 语句**：

<= 2;
```

**执行结果**：

```
i | p | o | rnk
--|---|---|----
4 | B | 2 |  1
2 | A | 2 |  1
```





### 示例 4：使用 DENSE\_RANK 函数

**SQL 语句**：

```sql
SELECT i, p, o, DENSE_RANK() OVER (PARTITION BY p ORDER BY o) as dense_rnk
FROM qualify_test 
QUALIFY dense_rnk = 1;
```

**执行结果**：

```
i | p | o | dense_rnk
--|---|---|----------
1 | A | 1 |    1
3 | B | 1 |    1
```





### 示例 5：使用聚合窗口函数

**场景说明**： 获取分组总和大于等于 3 的所有行

**SQL 语句**：

```sql
SELECT i, p, o, SUM(o) OVER (PARTITION BY p) as total
FROM qualify_test 
QUALIFY total >

**执行结果**：

```
i | p | o | total
--|---|---|-----
1 | A | 1 |  3
2 | A | 2 |  3
3 | B | 1 |  3
4 | B | 2 |  3
```




## 与传统子查询的对比

### 传统方式（使用子查询）

```sql
SELECT * FROM (
    SELECT i, p, o, ROW_NUMBER() OVER (PARTITION BY p ORDER BY o) as row_num 
    FROM qualify_test
) t
WHERE row_num = 1;
```

### QUALIFY 方式（推荐）

```sql
SELECT i, p, o, ROW_NUMBER() OVER (PARTITION BY p ORDER BY o) as row_num
FROM qualify_test 
QUALIFY row_num = 1;
```

### 优势对比

| 方面     | 传统方式       | QUALIFY 方式 |
| -------- | -------------- | ------------ |
| 代码复杂度 | 高（嵌套子查询） | 低（平铺）     |
| 可读性   | 一般           | 优秀 ✓       |
| 代码行数 | 4-5 行         | 3 行         |
| 性能     | 相当           | 相当         |
| 维护成本 | 高             | 低 ✓         |





## 注意事项

### 必须遵循的规则

* 窗口函数必须在 SELECT 子句中定义并给定别名
* 在 QUALIFY 子句中使用窗口函数的别名进行条件判断
* QUALIFY 必须引用至少一个窗口函数


