# GROUP BY

## 概述

`GROUP BY` 子句是 SQL 查询中用于数据分组和聚合分析的核心组件。通过 `GROUP BY`，可以将数据集按照指定的列或表达式进行分组，并对每个分组应用聚合函数（如 `SUM()`、`COUNT()`、`AVG()`、`MAX()`、`MIN()` 等）计算汇总值。

云器 Lakehouse 完整支持标准 SQL GROUP BY 语法，并提供高级聚合能力：

| 功能                | 说明         | 应用场景           |
| ----------------- | ---------- | -------------- |
| **标准 GROUP BY**   | 基础分组聚合     | 日常统计、基础报表      |
| **GROUPING SETS** | 自定义多个分组集合  | 多维度业务分析        |
| **ROLLUP**        | 层级汇总（从细到总） | 财务报表、销售层级分析    |
| **CUBE**          | 全维度交叉分析    | BI 多维数据透视、交叉分析 |

***

## 语法结构

```sql
SELECT 
    column1,
    column2,
    aggregate_function(column3) AS alias
FROM table_name
WHERE condition
GROUP BY 
    [ group_expression [, group_expression, ...] |
      GROUPING SETS (grouping_set [, grouping_set, ...]) |
      ROLLUP(expression [, expression, ...]) |
      CUBE(expression [, expression, ...]) ]
HAVING aggregate_condition
ORDER BY column
LIMIT n;
```

### 关键要点

1. **SELECT 子句约束**：SELECT 列表中的非聚合列必须出现在 GROUP BY 子句中
2. **执行顺序**：FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT
3. **HAVING 过滤**：用于过滤聚合结果，而 WHERE 过滤原始行
4. **NULL 值处理**：NULL 被视为一个独立的分组

***

## 准备测试数据

本文档使用汽车经销商销售数据作为示例。创建测试视图：

```sql
CREATE OR REPLACE VIEW dealer (id, city, car_model, quantity) AS
VALUES 
    (100, 'Fremont', 'Honda Civic', 10),
    (100, 'Fremont', 'Honda Accord', 15),
    (100, 'Fremont', 'Honda CRV', 7),
    (200, 'Dublin', 'Honda Civic', 20),
    (200, 'Dublin', 'Honda Accord', 10),
    (200, 'Dublin', 'Honda CRV', 3),
    (300, 'San Jose', 'Honda Civic', 5),
    (300, 'San Jose', 'Honda Accord', 8);
```

查看原始数据：

```sql
SELECT * FROM dealer ORDER BY id, car_model LIMIT 50;
```

**查询结果**：

| id  | city     | car\_model   | quantity |
| --- | -------- | ------------ | -------- |
| 100 | Fremont  | Honda Accord | 15       |
| 100 | Fremont  | Honda CRV    | 7        |
| 100 | Fremont  | Honda Civic  | 10       |
| 200 | Dublin   | Honda Accord | 10       |
| 200 | Dublin   | Honda CRV    | 3        |
| 200 | Dublin   | Honda Civic  | 20       |
| 300 | San Jose | Honda Accord | 8        |
| 300 | San Jose | Honda Civic  | 5        |

***

## 一、标准 GROUP BY

### 1.1 单列分组

按经销商 ID 分组，统计每个经销商的销量：

```sql
SELECT 
    id, 
    SUM(quantity) AS total_quantity
FROM dealer
GROUP BY id
ORDER BY id
LIMIT 50;
```

**查询结果**：

| id  | total\_quantity |
| --- | --------------- |
| 100 | 32              |
| 200 | 33              |
| 300 | 13              |

**业务解读**：

*   经销商 100（Fremont）销售了 32 辆车
*   经销商 200（Dublin）销售了 33 辆车
*   经销商 300（San Jose）销售了 13 辆车

***

### 1.2 多列分组

按城市和车型的组合进行分组统计：

```sql
SELECT 
    id, 
    city, 
    SUM(quantity) AS total_quantity
FROM dealer
GROUP BY id, city
ORDER BY total_quantity DESC
LIMIT 50;
```

**查询结果**：

| id  | city     | total\_quantity |
| --- | -------- | --------------- |
| 200 | Dublin   | 33              |
| 100 | Fremont  | 32              |
| 300 | San Jose | 13              |

在本示例中，每个经销商 ID 对应唯一的城市，因此结果与单列分组相同。

***

### 1.3 使用表达式分组

使用 `CASE` 表达式对销量进行分段统计：

```sql
SELECT 
    CASE 
        WHEN quantity < 10 THEN 'Low (< 10)'
        WHEN quantity < 15 THEN 'Medium (10-14)'
        ELSE 'High (>= 15)'
    END AS sales_level,
    COUNT(*) AS record_count,
    SUM(quantity) AS total_quantity
FROM dealer
GROUP BY 
    CASE 
        WHEN quantity < 10 THEN 'Low (< 10)'
        WHEN quantity < 15 THEN 'Medium (10-14)'
        ELSE 'High (>= 15)'
    END
ORDER BY sales_level
LIMIT 50;
```

**查询结果**：

| sales\_level   | record\_count | total\_quantity |
| -------------- | ------------- | --------------- |
| High (>= 15)   | 2             | 35              |
| Low (< 10)     | 4             | 23              |
| Medium (10-14) | 2             | 20              |

**业务解读**：

* 高销量记录（≥15 辆）：2 条记录，共 35 辆
* 低销量记录（<10 辆）：4 条记录，共 23 辆
* 中等销量记录（10-14 辆）：2 条记录，共 20 辆

***

### 1.4 全局聚合（无分组）

不使用 GROUP BY 时，对整个表进行全局聚合：

```sql
SELECT SUM(quantity) AS total_quantity 
FROM dealer
LIMIT 50;
```

**查询结果**：

| total\_quantity |
| --------------- |
| 78              |

全部 8 条记录的总销量为 78 辆。

***

## 二、多聚合函数组合

### 2.1 常用聚合函数汇总

在单次查询中使用多个聚合函数：

```sql
SELECT 
    city,
    COUNT(*) AS model_count,
    SUM(quantity) AS total_quantity,
    AVG(quantity) AS avg_quantity,
    MAX(quantity) AS max_quantity,
    MIN(quantity) AS min_quantity
FROM dealer
GROUP BY city
ORDER BY total_quantity DESC
LIMIT 50;
```

**查询结果**：

| city     | model\_count | total\_quantity | avg\_quantity      | max\_quantity | min\_quantity |
| -------- | ------------ | --------------- | ------------------ | ------------- | ------------- |
| Dublin   | 3            | 33              | 11.0               | 20            | 3             |
| Fremont  | 3            | 32              | 10.666666666666666 | 15            | 7             |
| San Jose | 2            | 13              | 6.5                | 8             | 5             |

**业务洞察**：

* **Dublin**：3 个车型，平均每个车型销售 11 辆，最高单品 20 辆（Honda Civic）
* **Fremont**：3 个车型，平均销量 10.67 辆，销量较均衡
* **San Jose**：仅 2 个车型，平均销量 6.5 辆，市场规模最小

***

### 2.2 按车型统计覆盖城市数

统计每个车型在多少个城市有销售：

```sql
SELECT 
    car_model,
    SUM(quantity) AS total_sales,
    COUNT(DISTINCT city) AS city_count,
    ROUND(AVG(quantity), 2) AS avg_per_dealer
FROM dealer
GROUP BY car_model
ORDER BY total_sales DESC
LIMIT 50;
```

**查询结果**：

| car\_model   | total\_sales | city\_count | avg\_per\_dealer |
| ------------ | ------------ | ----------- | ---------------- |
| Honda Civic  | 35           | 3           | 11.67            |
| Honda Accord | 33           | 3           | 11.00            |
| Honda CRV    | 10           | 2           | 5.00             |

**业务洞察**：

* **Honda Civic**：最畅销车型，总销量 35 辆，覆盖 3 个城市，平均每地 11.67 辆
* **Honda Accord**：总销量 33 辆，覆盖 3 个城市
* **Honda CRV**：总销量最低，仅在 2 个城市有销售（未进入 San Jose 市场）

***

## 三、GROUPING SETS（自定义分组集合）

### 3.1 基本概念

`GROUPING SETS` 允许在一次查询中同时生成多个不同维度的分组结果。它本质上是多个 `GROUP BY` 查询通过 `UNION ALL` 组合的简写形式。

**语法**：

```sql
GROUP BY GROUPING SETS (
    (column1, column2),  -- 分组集1：按 column1 和 column2 分组
    (column1),           -- 分组集2：仅按 column1 分组
    ()                   -- 分组集3：全局聚合（无分组）
)
```

***

### 3.2 多维度聚合分析

在一次查询中生成四个维度的统计结果：

```sql
SELECT 
    city, 
    car_model, 
    SUM(quantity) AS total_quantity
FROM dealer
GROUP BY GROUPING SETS (
    (city, car_model),  -- 城市+车型明细
    (city),             -- 按城市汇总
    (car_model),        -- 按车型汇总
    ()                  -- 总计
)
ORDER BY city, car_model
LIMIT 50;
```

**查询结果**：

| city     | car\_model   | total\_quantity |
| -------- | ------------ | --------------- |
| NULL     | NULL         | 78              |
| NULL     | Honda Accord | 33              |
| NULL     | Honda CRV    | 10              |
| NULL     | Honda Civic  | 35              |
| Dublin   | NULL         | 33              |
| Dublin   | Honda Accord | 10              |
| Dublin   | Honda CRV    | 3               |
| Dublin   | Honda Civic  | 20              |
| Fremont  | NULL         | 32              |
| Fremont  | Honda Accord | 15              |
| Fremont  | Honda CRV    | 7               |
| Fremont  | Honda Civic  | 10              |
| San Jose | NULL         | 13              |
| San Jose | Honda Accord | 8               |
| San Jose | Honda Civic  | 5               |

**结果解读**：

* **总计行**（city=NULL, car\_model=NULL）：全部销量 78 辆
* **车型汇总行**（city=NULL, car\_model有值）：各车型跨城市总销量
* **城市汇总行**（city有值, car\_model=NULL）：各城市跨车型总销量
* **明细行**（city和car\_model都有值）：城市+车型组合的具体销量

**等价查询**：

```sql
-- GROUPING SETS 等价于以下 UNION ALL 查询
SELECT city, car_model, SUM(quantity) FROM dealer GROUP BY city, car_model
UNION ALL
SELECT city, NULL, SUM(quantity) FROM dealer GROUP BY city
UNION ALL
SELECT NULL, car_model, SUM(quantity) FROM dealer GROUP BY car_model
UNION ALL
SELECT NULL, NULL, SUM(quantity) FROM dealer;
```

**性能优势**：`GROUPING SETS` 在内部只扫描一次数据，比 `UNION ALL` 更高效。

***

### 3.3 识别汇总层级

使用 `COALESCE` 函数替换 NULL 值，使汇总行更易读：

```sql
SELECT 
    COALESCE(city, 'All Cities') AS city,
    COALESCE(car_model, 'All Models') AS car_model,
    SUM(quantity) AS total_quantity
FROM dealer
GROUP BY ROLLUP(city, car_model)
ORDER BY city, car_model
LIMIT 50;
```

**查询结果**：

| city       | car\_model   | total\_quantity |
| ---------- | ------------ | --------------- |
| All Cities | All Models   | 78              |
| Dublin     | All Models   | 33              |
| Dublin     | Honda Accord | 10              |
| Dublin     | Honda CRV    | 3               |
| Dublin     | Honda Civic  | 20              |
| Fremont    | All Models   | 32              |
| Fremont    | Honda Accord | 15              |
| Fremont    | Honda CRV    | 7               |
| Fremont    | Honda Civic  | 10              |
| San Jose   | All Models   | 13              |
| San Jose   | Honda Accord | 8               |
| San Jose   | Honda Civic  | 5               |

***

## 四、ROLLUP（层级汇总）

### 4.1 基本概念

`ROLLUP` 用于生成从细粒度到全局的层级汇总。对于 `ROLLUP(a, b, c)`，将生成以下分组集：

* `(a, b, c)` - 最细粒度
* `(a, b)` - 中间层级
* `(a)` - 高层级
* `()` - 全局汇总

**等价关系**：

```sql
ROLLUP(city, car_model) 
-- 等价于
GROUPING SETS (
    (city, car_model),
    (city),
    ()
)
```

***

### 4.2 销售层级汇总

生成"城市→车型"两级汇总：

```sql
SELECT 
    city, 
    car_model, 
    SUM(quantity) AS total_quantity 
FROM dealer
GROUP BY ROLLUP(city, car_model)
LIMIT 50;
```

**查询结果**：

| city     | car\_model   | total\_quantity |
| -------- | ------------ | --------------- |
| Fremont  | Honda Civic  | 10              |
| Fremont  | Honda Accord | 15              |
| Fremont  | Honda CRV    | 7               |
| Dublin   | Honda Civic  | 20              |
| Dublin   | Honda Accord | 10              |
| Dublin   | Honda CRV    | 3               |
| San Jose | Honda Civic  | 5               |
| San Jose | Honda Accord | 8               |
| Fremont  | NULL         | 32              |
| Dublin   | NULL         | 33              |
| San Jose | NULL         | 13              |
| NULL     | NULL         | 78              |

**数据层级**：

1. **明细层**（前8行）：每个城市的每种车型的销量
2. **城市小计**（car\_model=NULL）：每个城市的总销量
3. **总计**（city=NULL, car\_model=NULL）：所有城市的总销量

***

### 4.3 使用 GROUPING() 函数标识层级

`GROUPING()` 函数返回 0 或 1，用于区分真实 NULL 和聚合标记：

* **返回 0**：该列参与分组，值为实际数据
* **返回 1**：该列未参与分组，NULL 表示汇总

```sql
SELECT 
    city,
    car_model,
    SUM(quantity) AS total_quantity,
    GROUPING(city) AS city_grouping,
    GROUPING(car_model) AS model_grouping
FROM dealer
GROUP BY ROLLUP(city, car_model)
ORDER BY city_grouping, city, model_grouping, car_model
LIMIT 50;
```

**查询结果**：

| city     | car\_model   | total\_quantity | city\_grouping | model\_grouping |
| -------- | ------------ | --------------- | -------------- | --------------- |
| Dublin   | Honda Accord | 10              | 0              | 0               |
| Dublin   | Honda CRV    | 3               | 0              | 0               |
| Dublin   | Honda Civic  | 20              | 0              | 0               |
| Dublin   | NULL         | 33              | 0              | 1               |
| Fremont  | Honda Accord | 15              | 0              | 0               |
| Fremont  | Honda CRV    | 7               | 0              | 0               |
| Fremont  | Honda Civic  | 10              | 0              | 0               |
| Fremont  | NULL         | 32              | 0              | 1               |
| San Jose | Honda Accord | 8               | 0              | 0               |
| San Jose | Honda Civic  | 5               | 0              | 0               |
| San Jose | NULL         | 13              | 0              | 1               |
| NULL     | NULL         | 78              | 1              | 1               |

**GROUPING() 值解读**：

* (**0, 0**)：明细数据，两列都参与分组
* (**0, 1**)：城市小计，仅 city 参与分组
* (**1, 1**)：全局总计，两列都不参与分组

***

## 五、CUBE（全维度交叉分析）

### 5.1 基本概念

`CUBE` 生成指定列的所有可能组合的分组集。对于 `CUBE(a, b)`，将生成 2² = 4 个分组集：

* `(a, b)` - 明细
* `(a)` - 按 a 汇总
* `(b)` - 按 b 汇总
* `()` - 全局汇总

**等价关系**：

```sql
CUBE(city, car_model)
-- 等价于
GROUPING SETS (
    (city, car_model),
    (city),
    (car_model),
    ()
)
```

***

### 5.2 多维交叉分析

生成城市和车型的所有维度组合：

```sql
SELECT 
    city, 
    car_model, 
    SUM(quantity) AS total_quantity 
FROM dealer
GROUP BY city, car_model WITH CUBE
LIMIT 50;
```

**查询结果**：

| city     | car\_model   | total\_quantity |
| -------- | ------------ | --------------- |
| Fremont  | Honda Civic  | 10              |
| Fremont  | Honda Accord | 15              |
| Fremont  | Honda CRV    | 7               |
| Dublin   | Honda Civic  | 20              |
| Dublin   | Honda Accord | 10              |
| Dublin   | Honda CRV    | 3               |
| San Jose | Honda Civic  | 5               |
| San Jose | Honda Accord | 8               |
| NULL     | Honda CRV    | 10              |
| NULL     | Honda Civic  | 35              |
| NULL     | Honda Accord | 33              |
| Fremont  | NULL         | 32              |
| Dublin   | NULL         | 33              |
| San Jose | NULL         | 13              |
| NULL     | NULL         | 78              |

**结果包含**：

1. **明细行**（前8行）：城市+车型组合
2. **车型汇总行**（city=NULL）：跨城市的车型销量
3. **城市汇总行**（car\_model=NULL）：跨车型的城市销量
4. **总计行**（city=NULL, car\_model=NULL）：全局总计

***

### 5.3 标识聚合层级

使用 `CASE` 语句结合 `GROUPING()` 函数标识每行的聚合层级：

```sql
SELECT 
    city,
    car_model,
    SUM(quantity) AS total_quantity,
    CASE 
        WHEN GROUPING(city) = 1 AND GROUPING(car_model) = 1 THEN 'Total'
        WHEN GROUPING(city) = 0 AND GROUPING(car_model) = 1 THEN 'City Subtotal'
        WHEN GROUPING(city) = 1 AND GROUPING(car_model) = 0 THEN 'Model Subtotal'
        ELSE 'Detail'
    END AS aggregation_level
FROM dealer
GROUP BY CUBE(city, car_model)
ORDER BY 
    GROUPING(city),
    GROUPING(car_model),
    city,
    car_model
LIMIT 50;
```

**查询结果**：

| city     | car\_model   | total\_quantity | aggregation\_level |
| -------- | ------------ | --------------- | ------------------ |
| Dublin   | Honda Accord | 10              | Detail             |
| Dublin   | Honda CRV    | 3               | Detail             |
| Dublin   | Honda Civic  | 20              | Detail             |
| Fremont  | Honda Accord | 15              | Detail             |
| Fremont  | Honda CRV    | 7               | Detail             |
| Fremont  | Honda Civic  | 10              | Detail             |
| San Jose | Honda Accord | 8               | Detail             |
| San Jose | Honda Civic  | 5               | Detail             |
| Dublin   | NULL         | 33              | City Subtotal      |
| Fremont  | NULL         | 32              | City Subtotal      |
| San Jose | NULL         | 13              | City Subtotal      |
| NULL     | Honda Accord | 33              | Model Subtotal     |
| NULL     | Honda CRV    | 10              | Model Subtotal     |
| NULL     | Honda Civic  | 35              | Model Subtotal     |
| NULL     | NULL         | 78              | Total              |

此查询清晰地标识了每行数据所属的聚合层级。

***

### 5.4 ROLLUP vs CUBE

| 维度              | ROLLUP         | CUBE                |
| --------------- | -------------- | ------------------- |
| **生成分组集**       | 层级子集（从左到右）     | 所有可能组合              |
| **ROLLUP(a,b**) | (a,b), (a), () | (a,b), (a), (b), () |
| **分组数量**        | n+1（n为列数）      | 2ⁿ                  |
| **使用场景**        | 层级报表、自上而下分析    | 多维交叉分析、BI 透视表       |
| **性能**          | 生成分组数少，性能更优    | 生成分组数多，性能开销较大       |

**选择建议**：

* 需要**层级汇总**（如 地区→城市→门店）时使用 `ROLLUP`
* 需要**多维交叉分析**（如 地区×产品×时间）时使用 `CUBE`
* 需要**自定义组合**时使用 `GROUPING SETS`

***

## 六、HAVING 子句：过滤聚合结果

### 6.1 WHERE vs HAVING

| 子句         | 执行时机 | 作用对象  | 可用函数            |
| ---------- | ---- | ----- | --------------- |
| **WHERE**  | 分组前  | 原始行数据 | 标量函数、列比较        |
| **HAVING** | 分组后  | 聚合结果  | 聚合函数、GROUP BY 列 |

**执行顺序**：FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT

***

### 6.2 使用 HAVING 过滤聚合结果

筛选总销量超过 15 辆的城市：

```sql
SELECT 
    city,
    COUNT(*) AS record_count,
    SUM(quantity) AS total_quantity
FROM dealer
GROUP BY city
HAVING SUM(quantity) > 15
ORDER BY total_quantity DESC
LIMIT 50;
```

**查询结果**：

| city    | record\_count | total\_quantity |
| ------- | ------------- | --------------- |
| Dublin  | 3             | 33              |
| Fremont | 3             | 32              |

San Jose（总销量 13 辆）被过滤掉，因为不满足 `HAVING` 条件。

***

### 6.3 WHERE 与 HAVING 组合

先用 `WHERE` 过滤原始数据，再用 `HAVING` 过滤聚合结果：

```sql
SELECT 
    city,
    COUNT(*) AS record_count,
    SUM(quantity) AS total_quantity
FROM dealer
WHERE quantity >= 10  -- 先过滤：只统计销量≥10的记录
GROUP BY city
HAVING COUNT(*) >= 2  -- 再过滤：只显示记录数≥2的城市
ORDER BY total_quantity DESC
LIMIT 50;
```

**执行逻辑**：

1. **WHERE 过滤**：排除 quantity < 10 的记录（过滤掉 4 条记录）
2. **GROUP BY 分组**：对剩余记录按 city 分组
3. **HAVING 过滤**：只保留记录数 ≥ 2 的分组

***

## 七、高级应用场景

### 7.1 行转列：透视分析

将车型从行转换为列，实现透视表效果：

```sql
SELECT 
    city,
    SUM(CASE WHEN car_model = 'Honda Civic' THEN quantity ELSE 0 END) AS civic_sales,
    SUM(CASE WHEN car_model = 'Honda Accord' THEN quantity ELSE 0 END) AS accord_sales,
    SUM(CASE WHEN car_model = 'Honda CRV' THEN quantity ELSE 0 END) AS crv_sales,
    SUM(quantity) AS total_sales
FROM dealer
GROUP BY city
ORDER BY total_sales DESC
LIMIT 50;
```

**查询结果**：

| city     | civic\_sales | accord\_sales | crv\_sales | total\_sales |
| -------- | ------------ | ------------- | ---------- | ------------ |
| Dublin   | 20           | 10            | 3          | 33           |
| Fremont  | 10           | 15            | 7          | 32           |
| San Jose | 5            | 8             | 0          | 13           |

**业务价值**：

* 清晰展示每个城市各车型的销量分布
* San Jose 没有 CRV 销售记录（显示为 0）
* 适合用于 Excel 报表、BI 仪表板

***

### 7.2 占比分析：窗口函数与 GROUP BY

计算每个车型在其所在城市的销量占比：

```sql
SELECT 
    city,
    car_model,
    quantity,
    SUM(quantity) OVER (PARTITION BY city) AS city_total,
    ROUND(quantity * 100.0 / SUM(quantity) OVER (PARTITION BY city), 2) AS percentage
FROM dealer
ORDER BY city, car_model
LIMIT 50;
```

**查询结果**：

| city     | car\_model   | quantity | city\_total | percentage |
| -------- | ------------ | -------- | ----------- | ---------- |
| Dublin   | Honda Accord | 10       | 33          | 30.30      |
| Dublin   | Honda CRV    | 3        | 33          | 9.09       |
| Dublin   | Honda Civic  | 20       | 33          | 60.61      |
| Fremont  | Honda Accord | 15       | 32          | 46.88      |
| Fremont  | Honda CRV    | 7        | 32          | 21.88      |
| Fremont  | Honda Civic  | 10       | 32          | 31.25      |
| San Jose | Honda Accord | 8        | 13          | 61.54      |
| San Jose | Honda Civic  | 5        | 13          | 38.46      |

**业务洞察**：

* **Dublin**：Honda Civic 占比 60.61%，是绝对主力车型
* **Fremont**：销量分布较均衡，Accord 占比最高（46.88%）
* **San Jose**：Accord 占比 61.54%，市场偏好明显

**技术说明**：窗口函数 `SUM() OVER (PARTITION BY city)` 计算每个城市的总销量，但不改变行数。

***

### 7.3 同比环比分析模式

虽然示例数据不包含时间维度，但提供标准的同比/环比分析 SQL 模式：

```sql
-- 示例：按月统计销量，计算环比增长
SELECT 
    DATE_FORMAT(sale_date, 'yyyy-MM') AS month,
    SUM(quantity) AS monthly_sales,
    LAG(SUM(quantity)) OVER (ORDER BY DATE_FORMAT(sale_date, 'yyyy-MM')) AS prev_month_sales,
    ROUND(
        (SUM(quantity) - LAG(SUM(quantity)) OVER (ORDER BY DATE_FORMAT(sale_date, 'yyyy-MM'))) * 100.0 / 
        LAG(SUM(quantity)) OVER (ORDER BY DATE_FORMAT(sale_date, 'yyyy-MM')), 
        2
    ) AS mom_growth_rate
FROM sales_table
GROUP BY DATE_FORMAT(sale_date, 'yyyy-MM')
ORDER BY month;
```

**关键技术**：

* `LAG()` 窗口函数获取上一行的值
* 环比增长率 = (当前值 - 上期值) / 上期值 × 100%

***

### 7.4 TopN 分析：每组取前 N

使用窗口函数结合 GROUP BY 实现分组 TopN：

```sql
-- 示例：每个城市销量前 2 的车型
SELECT *
FROM (
    SELECT 
        city,
        car_model,
        quantity,
        ROW_NUMBER() OVER (PARTITION BY city ORDER BY quantity DESC) AS rank
    FROM dealer
) ranked
WHERE rank <= 2
ORDER BY city, rank;
```

**预期逻辑**（基于当前数据）：

* Dublin：Honda Civic (20), Honda Accord (10)
* Fremont：Honda Accord (15), Honda Civic (10)
* San Jose：Honda Accord (8), Honda Civic (5)

***

## 八、性能优化与最佳实践

### 8.1 查询性能优化

#### 1. 合理使用 LIMIT

对于大数据集，始终添加 `LIMIT` 限制返回行数：

```sql
-- 推荐
SELECT city, SUM(quantity) 
FROM large_table 
GROUP BY city
LIMIT 100;

-- 避免：可能返回数百万行
SELECT city, SUM(quantity) 
FROM large_table 
GROUP BY city;
```

#### 2. 选择合适的聚合工具

| 需求     | 推荐方案            | 生成分组数 | 性能    |
| ------ | --------------- | ----- | ----- |
| 简单层级汇总 | `ROLLUP`        | n+1   | ⭐⭐⭐⭐⭐ |
| 多维交叉分析 | `CUBE`          | 2ⁿ    | ⭐⭐⭐   |
| 自定义分组集 | `GROUPING SETS` | 自定义   | ⭐⭐⭐⭐  |

**示例**：对于 3 列分组

* `ROLLUP(a,b,c)` 生成 4 个分组集
* `CUBE(a,b,c)` 生成 8 个分组集
* `GROUPING SETS` 可自定义任意组合

#### 3. 降低分组列基数

对高基数列（如 ID、timestamp）使用函数降低粒度：

```sql
-- 避免：按秒级 timestamp 分组
GROUP BY timestamp  -- 可能产生数百万个分组

-- 推荐：按小时或天分组
GROUP BY DATE_FORMAT(timestamp, 'yyyy-MM-dd')
GROUP BY DATE_TRUNC('hour', timestamp)
```

#### 4. WHERE 过滤优于 HAVING 过滤

尽量在 `WHERE` 中过滤数据，减少 `GROUP BY` 处理的数据量：

```sql
-- 推荐：先过滤再分组
SELECT city, SUM(quantity)
FROM dealer
WHERE car_model = 'Honda Civic'  -- 先过滤，减少数据量
GROUP BY city;

-- 避免：先分组再过滤（处理了不必要的数据）
SELECT city, car_model, SUM(quantity)
FROM dealer
GROUP BY city, car_model
HAVING car_model = 'Honda Civic';
```

***

### 8.2 常见错误与解决方案

#### 错误 1：SELECT 列未在 GROUP BY 中

```sql
-- ❌ 错误示例
SELECT city, car_model, quantity
FROM dealer
GROUP BY city;
-- 错误：car_model 和 quantity 未分组或聚合

-- ✅ 正确方案1：添加到 GROUP BY
SELECT city, car_model, SUM(quantity)
FROM dealer
GROUP BY city, car_model;

-- ✅ 正确方案2：使用聚合函数
SELECT city, MAX(car_model), SUM(quantity)
FROM dealer
GROUP BY city;
```

#### 错误 2：WHERE 中使用聚合函数

```sql
-- ❌ 错误示例
SELECT city, SUM(quantity)
FROM dealer
WHERE SUM(quantity) > 20  -- WHERE 不能使用聚合函数
GROUP BY city;

-- ✅ 正确方案：使用 HAVING
SELECT city, SUM(quantity)
FROM dealer
GROUP BY city
HAVING SUM(quantity) > 20;
```

#### 错误 3：混淆 ROLLUP/CUBE 语法

```sql
-- ❌ 错误示例
GROUP BY city, ROLLUP(car_model)  -- 不支持混合语法

-- ✅ 正确方案
GROUP BY ROLLUP(city, car_model)
```

#### 错误 4：忽略 NULL 值影响

```sql
-- 在 ROLLUP/CUBE 中，NULL 既可能是真实 NULL，也可能是汇总标记
-- 使用 GROUPING() 函数区分

SELECT 
    CASE WHEN GROUPING(city) = 1 THEN 'Total' ELSE city END AS city,
    SUM(quantity)
FROM dealer
GROUP BY ROLLUP(city);
```

***

### 8.3 数据质量检查

#### 检查分组完整性

验证分组汇总是否等于总计：

```sql
-- 方法1：使用 ROLLUP 自动生成总计行
SELECT 
    COALESCE(city, 'TOTAL') AS city,
    SUM(quantity) AS total
FROM dealer
GROUP BY ROLLUP(city);

-- 方法2：手动验证
WITH group_totals AS (
    SELECT SUM(quantity) AS grouped_sum
    FROM dealer
    GROUP BY city
),
grand_total AS (
    SELECT SUM(quantity) AS total_sum
    FROM dealer
)
SELECT 
    (SELECT SUM(grouped_sum) FROM group_totals) AS sum_of_groups,
    (SELECT total_sum FROM grand_total) AS grand_total,
    CASE 
        WHEN (SELECT SUM(grouped_sum) FROM group_totals) = (SELECT total_sum FROM grand_total)
        THEN 'PASS'
        ELSE 'FAIL'
    END AS validation_result;
```

***

## 九、实战案例汇总

### 9.1 销售分析报表

**需求**：生成包含明细、小计、总计的销售报表

```sql
SELECT 
    COALESCE(city, 'All Cities') AS city,
    COALESCE(car_model, 'All Models') AS car_model,
    SUM(quantity) AS total_quantity
FROM dealer
GROUP BY ROLLUP(city, car_model)
ORDER BY 
    GROUPING(city),
    city,
    GROUPING(car_model),
    car_model
LIMIT 50;
```

***

### 9.2 多维交叉分析

**需求**：BI 透视表，需要城市和车型的所有维度组合

```sql
SELECT 
    city,
    car_model,
    SUM(quantity) AS total_quantity,
    CASE 
        WHEN GROUPING(city) = 1 AND GROUPING(car_model) = 1 THEN 'Grand Total'
        WHEN GROUPING(city) = 1 THEN 'Model Total'
        WHEN GROUPING(car_model) = 1 THEN 'City Total'
        ELSE 'Detail'
    END AS level
FROM dealer
GROUP BY CUBE(city, car_model)
ORDER BY 
    GROUPING(city),
    GROUPING(car_model),
    city,
    car_model
LIMIT 50;
```

***

### 9.3 Top/Bottom N 分析

**需求**：找出销量最高和最低的城市

```sql
-- Top 2 城市
SELECT city, SUM(quantity) AS total_quantity
FROM dealer
GROUP BY city
ORDER BY total_quantity DESC
LIMIT 2;

-- Bottom 2 城市
SELECT city, SUM(quantity) AS total_quantity
FROM dealer
GROUP BY city
ORDER BY total_quantity ASC
LIMIT 2;
```

***

### 9.4 占比与排名

**需求**：计算每个车型的销量占比和排名

```sql
SELECT 
    car_model,
    SUM(quantity) AS total_sales,
    ROUND(SUM(quantity) * 100.0 / (SELECT SUM(quantity) FROM dealer), 2) AS percentage,
    RANK() OVER (ORDER BY SUM(quantity) DESC) AS rank
FROM dealer
GROUP BY car_model
ORDER BY total_sales DESC
LIMIT 50;
```

***

## 十、功能对比与选择指南

### 10.1 四种分组方式对比

| 特性        | GROUP BY | GROUPING SETS | ROLLUP | CUBE     |
| --------- | -------- | ------------- | ------ | -------- |
| **语法复杂度** | 简单       | 中等            | 简单     | 简单       |
| **生成分组数** | 1        | 自定义           | n+1    | 2ⁿ       |
| **灵活性**   | 低        | 高             | 中      | 中        |
| **性能**    | 最优       | 优             | 优      | 较差（列数多时） |
| **适用场景**  | 基础统计     | 自定义多维分析       | 层级报表   | 全维交叉分析   |

***

### 10.2 选择决策树

```
是否需要多维度汇总？
├─ 否 → 使用标准 GROUP BY
└─ 是 → 需要哪些维度组合？
    ├─ 所有可能组合 → 使用 CUBE
    ├─ 层级汇总（从细到总）→ 使用 ROLLUP
    └─ 自定义特定组合 → 使用 GROUPING SETS
```

***

### 10.3 推荐使用场景

| 业务场景     | 推荐方案                 | 示例           |
| -------- | -------------------- | ------------ |
| 日常统计报表   | `GROUP BY`           | 按部门统计销售额     |
| 财务分层汇总   | `ROLLUP`             | 公司→部门→团队层级汇总 |
| BI 数据透视表 | `CUBE`               | 产品×地区×时间三维分析 |
| 自定义业务报表  | `GROUPING SETS`      | 同时输出日报、周报、月报 |
| 占比分析     | `GROUP BY` + 窗口函数    | 各产品销量占比      |
| Top N 分析 | `GROUP BY` + `LIMIT` | 销量前10的产品     |

***

## 十一、进阶技巧

### 11.1 动态分组

使用变量或子查询实现动态分组条件（示例逻辑）：

```sql
-- 根据销量范围动态分组
SELECT 
    CASE 
        WHEN SUM(quantity) >= 30 THEN 'High Volume'
        WHEN SUM(quantity) >= 15 THEN 'Medium Volume'
        ELSE 'Low Volume'
    END AS volume_tier,
    COUNT(DISTINCT city) AS city_count
FROM (
    SELECT city, SUM(quantity) AS city_total
    FROM dealer
    GROUP BY city
) city_summary
GROUP BY 
    CASE 
        WHEN city_total >= 30 THEN 'High Volume'
        WHEN city_total >= 15 THEN 'Medium Volume'
        ELSE 'Low Volume'
    END;
```

***

### 11.2 递归汇总（模拟）

虽然云器 Lakehouse 目前还不直接支持递归 CTE，但可通过 UNION ALL 模拟多层级汇总：

```sql
-- 三层汇总：明细、城市小计、总计
SELECT city, car_model, quantity, 'Detail' AS level
FROM dealer
UNION ALL
SELECT city, NULL, SUM(quantity), 'City Subtotal'
FROM dealer
GROUP BY city
UNION ALL
SELECT NULL, NULL, SUM(quantity), 'Grand Total'
FROM dealer
ORDER BY 
    CASE level 
        WHEN 'Detail' THEN 1
        WHEN 'City Subtotal' THEN 2
        WHEN 'Grand Total' THEN 3
    END,
    city,
    car_model;
```

***

### 11.3 NULL 值处理技巧

#### 技巧 1：区分真实 NULL 和聚合 NULL

```sql
SELECT 
    city,
    car_model,
    SUM(quantity) AS total,
    CASE 
        WHEN GROUPING(city) = 1 THEN '[Subtotal]'
        WHEN city IS NULL THEN '[Real NULL]'
        ELSE city
    END AS city_display
FROM dealer
GROUP BY ROLLUP(city, car_model);
```

#### 技巧 2：使用 COALESCE 美化输出

```sql
SELECT 
    COALESCE(city, '📊 All Cities') AS city,
    COALESCE(car_model, '🚗 All Models') AS car_model,
    SUM(quantity) AS total
FROM dealer
GROUP BY CUBE(city, car_model);
```

***

## 十二、总结

### 核心要点

1. **GROUP BY** 是数据聚合分析的基础，掌握其用法是 SQL 分析的必备技能
2. **GROUPING SETS / ROLLUP / CUBE** 提供了强大的多维分析能力，一次查询生成多层级汇总
3. **HAVING** 用于过滤聚合结果，与 WHERE 配合实现灵活的数据筛选
4. **窗口函数** 与 GROUP BY 结合，可实现复杂的占比、排名、同环比分析
5. **性能优化** 需要权衡灵活性与效率，合理选择分组方式

***

### 学习路径建议

1. **基础阶段**：掌握标准 GROUP BY 和常用聚合函数
2. **进阶阶段**：学习 GROUPING SETS、ROLLUP、CUBE 的使用场景
3. **高级阶段**：结合窗口函数、CTE 实现复杂业务分析
4. **实战阶段**：应用于实际业务场景，优化查询性能

***

### 快速参考

```sql
-- 基础分组
SELECT column, AGG_FUNC(column) FROM table GROUP BY column;

-- 多维分组
SELECT col1, col2, AGG_FUNC(col3) 
FROM table 
GROUP BY GROUPING SETS ((col1, col2), (col1), ());

-- 层级汇总
SELECT col1, col2, AGG_FUNC(col3) 
FROM table 
GROUP BY ROLLUP(col1, col2);

-- 交叉分析
SELECT col1, col2, AGG_FUNC(col3) 
FROM table 
GROUP BY col1, col2 WITH CUBE;

-- 条件过滤
SELECT col1, AGG_FUNC(col2) 
FROM table 
WHERE condition
GROUP BY col1 
HAVING AGG_FUNC(col2) > value;
```

^
