## 功能描述

`PERCENTILE_APPROX` 函数用于计算近似百分位数。它返回表中指定列值的近似百分位数。

## 语法

```SQL
PERCENTILE_APPROX(value_expr, percentile) 
```

## 参数说明

* **value_expr**: 要计算百分位数的数值表达式。
* **percentile**: 所需的百分位数（0 到 1 之间）。
* **column**: 用于计算百分位数的列，通常按此列排序。

## 返回结果

返回指定百分位数的近似值。

## 示例

```SQL
SELECT percentile_approx(col, array(0.5, 0.4, 0.1)) as res
    FROM VALUES (0), (1), (2), (10) AS tab(col);
+---------------+
|      res      |
+---------------+
| [1.0,1.1,0.0] |
+---------------+
```


