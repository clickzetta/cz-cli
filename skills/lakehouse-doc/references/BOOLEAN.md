# BOOLEAN
`BOOLEAN` 类型用于表示逻辑值，即真或假。在 SQL 语句中，布尔类型常用于条件判断和逻辑运算。

## 语法
```
BOOLEAN
```

## 常量值
```
TRUE | FALSE
```

## 示例
```
-- 使用布尔类型进行条件查询
SELECT 
    employee_id,
    last_name,
    email,
    commission_pct
FROM 
    employees
WHERE 
    commission_pct IS NOT NULL AND commission_pct > 0.1;

-- 使用布尔类型进行逻辑运算
SELECT 
    last_name,
    commission_pct
FROM 
    employees
WHERE 
    commission_pct = 0.2 OR (commission_pct IS NOT NULL AND commission_pct < 0.3);

-- 将其他类型的值转换为布尔类型
SELECT 
    last_name,
    commission_pct,
    CASE 
        WHEN commission_pct IS NOT NULL THEN TRUE
        ELSE FALSE
    END AS has_commission
FROM 
    employees;
```

