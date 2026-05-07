# Lakehouse SQL查询语句

## 功能简介

Lakehouse支持使用标准的SQL SELECT语句进行数据查询。本文档将详细介绍查询语句的基本语法、参数说明以及使用示例，帮助您更高效地进行数据查询。

## 基本语法

```SQL
[WITH cte [, ...] ]
SELECT 
[ hints ] 
[ ALL | DISTINCT ]
select_expr [, (except_expr)] ...
FROM table_reference
[WHERE where_condition ] 
[GROUP BY [GROUPING SETS | ROLLUP | CUBE] {col_name | expr | position}]
    [ HAVING having_condition ]
[ ORDER BY order_condition [ ASC | DESC ] ]
[ LIMIT  <number> [OFFSET <number>]]
```

## 参数说明

**1. WITH cte** (可选)
[公用表表达式](WITH.md)，用于在查询中定义临时结果集。

**2. ALL | DISTINCT** (可选)：对结果集进行刷选，all 为全部，distinct 将刷选出重复列，默认为 all

```
--表示不对cp_start_date_sk去重
SELECT ALL cp_start_date_sk FROM catalog_page;
--表示对cp_start_date_sk去重
SELECT DISTINCT cp_start_date_sk FROM catalog_page;
```

**3. HINTS** (可选): 帮助Lakehouse优化器作出更好的计划决策。目前支持[map join](mapjoin.md)如下案例

```SQL
SELECT /*+ MAPJOIN (t2) */ * FROM table1 t1
JOIN table2 t2
ON (t1.emp_id = t2.emp_id);
```

**4. select\_expr** (必填)
指定需要查询的列，支持列名、列表达式等。例如：col1\_name, col2\_name, 列表达式, ...

**1）排除列**（可选）
可选。`except_expr`格式为`except(col1_name, col2_name, ...)`。当您希望读取表内大多数列的数据，同时要排除表中少数列的数据时，可以通过`SELECT * except(col1_name, col2_name, ...) from ...;`语句实现，表示读取表数据时会排除指定列（col1、col2）的数据。

命令示例如下。

```SQL
--表结构如下
DESC students;
+-------------+-----------+---------+
| column_name | data_type | comment |
+-------------+-----------+---------+
| name        | string    |         |
| class       | string    |         |
+-------------+-----------+---------+
--排除class列
SELECT * EXCEPT(class) FROM students LIMIT 1;
+-------+
| name  |
+-------+
| Alice |
+-------+
```

**2）where\_condition** (可选)
过滤条件，用于筛选满足指定条件的数据。支持关系运算符、like、rlike、in、not in、between…and等。

* 配合关系运算符，筛选满足指定条件的数据。关系运算符包含：

  * `>`、`<`、`=`、`>=`、`<=`、`<>`
  * `like`、`rlike`
  * `in`、`not in`
  * `between…and`

**5. GROUP BY expression**(可选)

通常，group by和聚合函数配合使用，根据指定的普通列、分区列或正则表达式进行分组。`Grouping Sets`、`Rollup`、`Cube` 为 group by 的扩展，详细可以参考[GROUPING SET](groupby.md)，group by使用规则如下：

* group by操作优先级高于select操作，因此group by的取值是select输入表的列名或由输入表的列构成的表达式。需要注意的是：

  * group by取值为正则表达式时，必须使用列的完整表达式。
  * select语句中没有使用聚合函数的列必须出现在group by中。

**6. having\_condition**(可选)
通常`having`子句与聚合函数一起使用，实现过滤。

**7. order\_condition** (可选)
对所有数据按照指定列或常量进行全局排序。默认为升序排序，可使用`desc`关键字进行降序排序。默认情况下，升序排序会将 `NULL` 值放在最前面，而降序排序则将 `NULL` 放在最后面。Order by 是比较耗时耗资源的操作，因为所有数据都需要发送到 1 个节点后才能排序，排序操作相比不排序操作需要更多的内存。

**8. LIMIT ... OFFSET** (可选)

* LIMIT \<number> 表示查询结果只返回前 \<number> 条记录，其中 \<number> 是一个正整数。这个语法可以用来分页或者限制查询的数据量。支持LIMIT m,n写法。**使用 limit  offset的时候要加上 order by 才有意义，否则每次执行的数据可能会不一致**
* OFFSET \<number> 表示查询结果跳过前 \<number> 条记录，然后返回剩余的记录，其中 \<number> 是一个正整数。这个语法可以用来指定查询的起始位置。OFFSET关键字也可以用逗号代替
* LIMIT 和 OFFSET 可以同时使用，也可以单独使用。如果同时使用，那么 OFFSET 必须在 LIMIT 之后。例如，LIMIT 10 OFFSET 20 表示查询结果跳过前 20 条记录，然后返回接下来的 10 条记录。

## 查询历史版本数据

除标准 `SELECT` 选项外，Lakehoue还支持用户在定义的时间段内的任何时间点访问历史数据，包括已更改或删除的数据。支持查询表、动态表和物化视图
**请注意**：对象的历史查询取决于数据的保留周期。当前版本的数据保留周期默认为1天。您可以通过执行[ALTER命令](TIMETRAVEL.md)来调整保留周期。请注意，修改保留周期可能会增加存储成本。具体使用方式参考[TIME TRAVEL](TIMETRAVEL.md)

```sql
SELECT 
    table_identifier TIMESTAMP AS OF timestamp_expression
```

通过使用TIMESTAMP AS OF子句，用户可以指定具体的时间点，查询保留期内表历史记录中指定点的精确位置或紧邻指定点之前的数据。Timestamp\_expression是一个返回时间戳类型表达式的参数，例如：

* `'2023-11-07 14:49:18'`，即可强制转换为时间戳的字符串。
* `CAST('2023-11-07 14:49:18' AS TIMESTAMP)`。
* `CURRENT_TIMESTAMP() - INTERVAL 12 HOURS`。12小时之前的版本
* 任何本身是时间戳类型或可强制转换为时间戳的表达式。
  使用示例

```
SELECT * FROM events TIMESTAMP AS OF TIMESTAMP'2024-10-18 22:15:12.013'
```

## 语法糖：Trailing Commas

在SQL语句中，使用Trailing Commas可以让语句更容易阅读和编辑。即使在最后一个值或参数后面多了一个逗号，也不会报错。例如：

```SQL
SELECT    client_ip,
          client_identity,
          userid,
          user_agent,
          log_time
          -- status_code 
FROM      server_logs;
```

## 注意事项

* 建议您将提交的查询文本（即SQL语句）的大小限制为每个语句5MB。大于5MB的SQL文本将无法提交。如果您有超出5MB的SQL文本，请提交工单解决。
  当然可以，以下是根据您提供的 Apache Doris `SELECT` 语句文档和 Lakehouse SQL查询语句文档，生成的使用示例和最佳实践：

### 使用示例

1. **基本查询**
   ```SQL
   -- 查询所有学生的姓名和班级
   SELECT name, class FROM students;
   ```

2. **使用WITH子句（公用表表达式**）
   ```SQL
   WITH ranked_students AS (
     SELECT name, class, RANK() OVER (ORDER BY score DESC) as rank
     FROM students
   )
   SELECT * FROM ranked_students WHERE rank <= 10;
   ```

3. **去重查询**
   ```SQL
   -- 查询不同的班级名称
   SELECT DISTINCT class FROM students;
   ```

4. **使用HINTS优化查询**
   ```SQL
   SELECT /*+ MAPJOIN(t2) */ * FROM students t1
   JOIN classes t2 ON t1.class_id = t2.id;
   ```

5. **条件筛选**
   ```SQL
   -- 查询年龄大于20岁的学生姓名
   SELECT name FROM students WHERE age > 20;
   ```

6. **GROUP BY 和聚合函数**
   ```SQL
   -- 按班级分组，查询每个班级的平均成绩
   SELECT class, AVG(score) FROM students GROUP BY class;
   ```

7. **使用HAVING子句**
   ```SQL
   -- 查询平均成绩大于60分的班级
   SELECT class, AVG(score) as avg_score FROM students GROUP BY class HAVING avg_score > 60;
   ```

8. **ORDER BY 和 LIMIT**
   ```SQL
   -- 查询成绩降序排列的前5名学生
   SELECT name, score FROM students ORDER BY score DESC LIMIT 5;
   ```

9. **查询历史版本数据**
   ```SQL
   -- 查询2024-10-18 22:15:12.013时刻的学生表数据
   SELECT * FROM students TIMESTAMP AS OF TIMESTAMP'2024-10-18 22:15:12.013';
   ```

10. join示例
    参考[Join](JOIN.md)相关使用

## 最佳实践

1. **利用分区分桶过滤**
   * 尽可能利用Lakehouse的分区分桶作为数据过滤条件，减少数据扫描范围。

2. **使用索引字段**
   * 充分利用Lakehouse的索引字段作为数据过滤条件加速查询速度。参考[索引](guid-index.md)。

3. **合理使用聚合**
   * 聚合操作应该在数据量较大时使用，以减少数据传输和提高查询效率。

4. **使用ORDER BY和LIMIT进行分页**
   * 当需要分页查询时，使用ORDER BY和LIMIT组合可以有效地获取特定页面的数据。

5. **注意数据类型匹配**
   * 在使用UNION或JOIN时，确保连接的列具有相同的数据类型。

6. **避免大查询文本**
   * 将查询文本大小限制在5MB以内，以避免提交失败。

7. **使用HAVING子句过滤聚合结果**
   * HAVING子句应该在聚合函数之后使用，以过滤聚合后的结果集。

8. **使用WITH子句简化复杂查询**
   * 公用表表达式（WITH子句）可以简化复杂的查询，使其更易于理解和维护。

9. **注意查询成本**
   * 修改数据保留周期可能会增加存储成本，合理设置数据保留周期以平衡查询需求和成本。

^
