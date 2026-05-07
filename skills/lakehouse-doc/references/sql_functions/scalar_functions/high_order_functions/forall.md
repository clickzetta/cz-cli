### FORALL 函数

#### 简介
FORALL 函数用于判断数组中的所有元素是否满足指定的条件。该函数接受一个数组和一个单参数的 lambda 表达式作为输入，并返回一个布尔值结果。

#### 语法
``` sql
FORALL(array, x -> expr)
```

#### 参数说明
- `array`: 输入的数组，类型为 `array<T>`。
- `x -> expr`: 单参数形式的 lambda 表达式，其中 `x` 对应数组中的元素，`expr` 是需要返回布尔值的表达式。

#### 返回结果
- 返回一个布尔值，表示数组中的所有元素是否满足 lambda 表达式指定的条件。

#### 使用示例

1. 判断数组中的所有元素是否小于等于 3：
   ``` sql
   SELECT FORALL(array(1, 2, 3, 4, 5), x -> x <= 3) AS result;
   ```
   结果：
   ```
   result
   -------
   false
   ```

2. 判断数组中的所有元素是否大于 10：
   ``` sql
   SELECT FORALL(array(1, 20, 30, 4), x -> x > 10) AS result;
   ```
   结果：
   ```
   result
   -------
   false
   ```

3. 判断包含空值的数组中的所有非空元素是否小于等于 3：
   ``` sql
   SELECT FORALL(array(1, null, 3), x -> IF(x IS NOT NULL, x <= 3, true)) AS result;
   ```
   结果：
   ```
   result
   -------
   true
   ```

4. 判断数组中的所有偶数元素是否大于等于 2：
   ``` sql
   SELECT FORALL(array(1, 2, 3, 4, 6), x -> MOD(x, 2) = 0 AND x >= 2) AS result;
   ```
   结果：
   ```
   result
   -------
   false
   ```

#### 注意事项
- 当数组为空时，FORALL 函数将返回 `NULL` 值。
- 当 lambda 表达式中的条件不满足所有元素时，函数返回 `false`。
- 当 lambda 表达式中的条件满足所有元素时，函数返回 `true`。

