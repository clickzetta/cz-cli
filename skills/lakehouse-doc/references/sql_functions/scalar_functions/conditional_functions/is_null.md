### IS_NULL 函数

#### 功能描述
IS_NULL 函数用于判断给定的表达式（expr）是否为 NULL。如果表达式为 NULL，则返回 true，否则返回 false。该函数与 SQL 中的 IS NULL 语句具有相同的效果。

#### 语法
```
is_null(expr)
```

#### 参数说明
- `expr`：任意类型的表达式。

#### 返回结果
返回一个布尔值，当表达式为 NULL 时返回 true，否则返回 false。

#### 使用示例

1. 判断一个数字是否为 NULL：
   ```sql
   > SELECT is_null(NULL);
   true
   ```
2. 判断一个字符串是否为 NULL：
   ```sql
   > SELECT is_null('');
   false
   ```
3. 判断一个日期是否为 NULL：
   ```sql
   > SELECT is_null(NULL);
   true
   ```
4. 在查询中使用 IS_NULL 函数：
   ```sql
   > SELECT name, age, is_null(address) AS is_address_null FROM users;
   ```
   上述查询将返回用户表中的姓名、年龄以及地址是否为 NULL 的结果。

5. 与其他条件结合使用：
   ```sql
   > SELECT * FROM products WHERE is_null(price);
   ```
   上述查询将返回价格为 NULL 的产品记录。