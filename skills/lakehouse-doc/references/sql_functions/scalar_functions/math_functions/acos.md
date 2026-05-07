### ACOS

```sql

acos(expr)

```

#### 功能

计算 expr 的反余弦值。

#### 参数

* expr : double 类型，取值范围为 [-1, 1]，其余类型会进行隐式类型转换。

#### 返回结果

double 类型。

#### 举例

```sql
> SELECT acos(-1);
0.0
> SELECT acos(2);

NaN

```
