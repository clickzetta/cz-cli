
## 功能
`UNNEST` 是一种用于展开数组或嵌套数据结构的函数,常用于将数组类型的列转换为多行数据,以便进行行级分析。

## **语法**
```sql
SELECT [列名] FROM UNNEST(数组表达式) [AS 别名(列名)];
SELECT [列名] FROM 表名, UNNEST(数组列) [AS 别名(列名)]; -- 隐式 JOIN
```
## **参数说明**
`数组表达式`  ：需要展开的数组或嵌套数据结构（如多维数组、结构体）。
 `别名(列名)`：可选,为展开后的列指定别名和列名。
`LEFT JOIN` ：可选,保留左表的所有行,即使右表（`UNNEST` 结果）无匹配数据。
## **使用示例**
1. **基本数组展开**
将一维数组展开为多行,每行对应数组中的一个元素。
**示例：**
```sql
-- 输入：array(1,2,3)
SELECT * FROM UNNEST(array(1,2,3));
-- 输出：
-- 1
-- 2
-- 3
```
 2. **多数组列展开**
支持同时展开多个数组,按行对齐。若数组长度不一致,缺失值以 `NULL` 填充。
**示例：**
```sql
-- 输入：array(1,2,3), array('ab','cd')
SELECT * FROM UNNEST(array(1,2,3), array('ab','cd'));
-- 输出：
-- 1    ab
-- 2    cd
-- 3    NULL
```
3. **嵌套数组展开**
支持展开多维数组（递归展开）,生成扁平化结果。
**示例：**
```sql
-- 输入：array(array(1,2,3), array(4,5,6))
SELECT * FROM UNNEST(array(array(1,2,3), array(4,5,6)));
-- 输出：
-- 1
-- 2
-- 3
-- 4
-- 5
-- 6
```

4. **与 JOIN 结合使用**
可与其他表通过 `JOIN` 或 `CROSS JOIN` 进行关联,展开数组列。
**示例：**
```sql
-- 输入：表 t 包含列 k 和数组列 a
WITH t AS (SELECT * FROM VALUES (1, array(1,2,3)), (2, array(4,5)) AS t(k, a))
SELECT * FROM t, UNNEST(a);
-- 输出：
-- 1    [1,2,3]    1
-- 1    [1,2,3]    2
-- 1    [1,2,3]    3
-- 2    [4,5]      4
-- 2    [4,5]      5
```

 5. **处理 NULL 和空数组**
- 若数组为 `NULL`,展开后无结果。
- 若数组为空（`[]`）,展开后同样无结果。
**示例：**
```sql
-- 输入：数组列包含 NULL 或空值
CREATE VIEW student_score AS
SELECT id, scores FROM VALUES
(1, [80,85,87]),
(2, [77, NULL, 89]),
(3, NULL),
(4, []) AS students(id, scores);

SELECT id, scores, score FROM student_score, UNNEST(scores) AS t(score);
-- 输出：
-- 1    [80,85,87]    80
-- 1    [80,85,87]    85
-- 1    [80,85,87]    87
-- 2    [77,null,89]  77
-- 2    [77,null,89]  NULL
-- 2    [77,null,89]  89
```
6. **过滤展开结果**
```sql
-- 仅保留偶数元素
WITH t AS (SELECT * FROM VALUES (1, array(1,2,3)), (2, array(4,5)) AS t(k, a))
SELECT * FROM t LEFT JOIN UNNEST(a) u(e) WHERE u.e % 2 = 0;
-- 输出：
-- 1    [1,2,3]    2
-- 2    [4,5]      4
```


## **注意事项**
1. **参数类型限制**
   `UNNEST` 仅接受数组或嵌套结构作为输入,传递非数组类型会报错。
   ```sql
   -- 错误示例：输入为整数
   SELECT * FROM UNNEST(1); -- 报错：expect array type
   ```
