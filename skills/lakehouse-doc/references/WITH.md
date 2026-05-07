## 功能介绍
公用表表达式（CTE，Common Table Expression）是一种在单个 SQL 查询中定义的临时结果集，其作用范围仅限于定义它的查询语句。CTE 的主要优点在于可以提高 SQL 语句的可读性和重用性。

## 语法结构
```
WITH
    <cte_name1> AS (SELECT ...),
    [<cte_name2> AS (SELECT ...)],
    [<cte_nameN> AS (SELECT ...)]
SELECT ...
```

**参数说明：**

- `<cte_name>`：指定公用表表达式的名称，用于在查询中引用。

## 使用示例

**示例1：简单的CTE查询**

假设我们有一个名为 `orders` 的表，包含 `album_name` 和 `album_year` 两个字段。我们想要查询1976年发行的所有专辑名称，并按名称排序。使用CTE可以简化查询语句，如下所示：

```sql
WITH
my_cte AS (SELECT * FROM orders WHERE album_year = 1976),
my_cte2 AS (SELECT album_name,count(*) FROM my_cte group by album_name)
SELECT album_name FROM my_cte2 ORDER BY album_name;
```

**示例2：带过滤条件的CTE查询**

如果我们想查询1976年发行的专辑名称，但仅限于某个特定歌手的作品，可以在CTE中添加过滤条件：

```sql
WITH my_cte AS (SELECT * FROM orders WHERE album_year = 1976 AND artist = 'ArtistName')
SELECT album_name FROM my_cte ORDER BY album_name;
```




