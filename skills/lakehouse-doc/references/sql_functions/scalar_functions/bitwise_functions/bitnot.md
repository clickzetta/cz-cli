### BITNOT 函数

#### 概述
BITNOT 函数用于对整数类型的表达式进行按位取反操作。该函数可以处理任何整数类型的输入，并返回与输入类型相同的结果。除了使用 `bitnot()` 函数外，也可以使用 `~` 运算符实现相同的功能。

#### 语法
```
BITNOT(expr)
```
或
```
~expr
```

#### 参数
- `expr`：需要进行按位取反操作的整数类型表达式。

#### 返回值
- 返回与输入参数 `expr` 类型相同的按位取反后的结果。

#### 使用示例
1. 对单个整数进行按位取反操作：
   ```sql
   SELECT BITNOT(100); -- 返回结果: -101
   SELECT ~100;       -- 返回结果: -101
   ```

2. 对查询结果中的整数进行按位取反操作：
   ```sql
   SELECT BITNOT(column_name) FROM table_name WHERE condition;
   SELECT ~column_name FROM table_name WHERE condition;
   ```


