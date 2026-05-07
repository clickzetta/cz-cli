# INT
`INT` 是一个数据类型，表示 32 位有符号整型。它可以存储的数字范围为 -2,147,483,648 到 2,147,483,647。

## 语法
```
INT
```

## 示例
```
-- 将字符串转换为整数
SELECT CAST('5' AS INT);

-- 直接输入数字，系统会自动转换为整数
SELECT +1;

-- 结合其他数值计算
SELECT 3 * 4 + 2;

-- 存储在表中
CREATE TABLE example (
    id INT ,
    name VARCHAR(255)
);

-- 插入数据
INSERT INTO example (id, name) VALUES (1, 'Alice');

-- 查询数据
SELECT * FROM example;
```

## 注意事项
- 当使用 `CAST` 函数将其他类型的数据转换为 `INT` 类型时，如果输入的数据无法转换为整数，默认将返回 NULL。
- 在创建表时，可以指定列为 `INT` 类型，以便存储整数值。
- 在查询中，可以使用 `INT` 类型的数值进行各种计算，如加法、减法、乘法和除法。