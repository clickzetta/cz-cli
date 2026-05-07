### IF 函数

#### 功能描述

IF 函数是一个条件判断函数，根据提供的条件表达式（cond）来判断返回 expr1 或 expr2。当条件表达式的结果为 true 时，IF 函数返回 expr1 的值；当条件表达式的结果为 false 时，返回 expr2 的值。

#### 参数说明

* cond（条件表达式）：一个返回布尔值（true 或 false）的表达式。
* expr1（表达式1）：当 cond 为 true 时，IF 函数返回该表达式的值。
* expr2（表达式2）：当 cond 为 false 时，IF 函数返回该表达式的值。

#### 返回结果

IF 函数的返回类型与 expr1 和 expr2 的类型相同。

#### 使用示例

1. 示例 1：比较数值并返回结果

```sql
SELECT IF(a > 10, '大于10', '小于等于10') AS result FROM VALUES(5), (15), (10) AS t(a);

 result    
+-----------+
 小于等于10 
 大于10     
 小于等于10 

```

2. 示例 2：判断字符串是否为空

```sql
SELECT IF(name = '', '空字符串', '非空字符串') AS result FROM VALUES('张三'), (''), ('李四') AS t(name);
result
+-----------+
非空字符串
空字符串
非空字符串

```

3. 示例 3：根据成绩判断等级

```sql
SELECT IF(score >= 90, '优秀', IF(score >= 60, '及格', '不及格')) AS grade FROM VALUES(85), (95), (55) AS t(score);
grade
+-----------+
及格
优秀
不及格

```


