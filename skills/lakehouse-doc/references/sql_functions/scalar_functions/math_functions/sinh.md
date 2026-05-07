### 双曲正弦函数 (SINH)

---

#### 功能描述
`sinh` 函数用于计算给定数值表达式的双曲正弦（hyperbolic sine）。双曲正弦函数是数学中双曲函数的一种，其定义为 `sinh(x) = (e^x - e^(-x)) / 2`，其中 `e` 是自然对数的底数。

#### 语法
```
sinh(expr)
```
#### 参数
- `expr`: 需要计算双曲正弦的数值表达式，类型为 `double`。

#### 返回结果
返回计算后的双曲正弦值，类型为 `double`。

#### 使用示例
1. 计算 `sinh(0)`:
```sql
SELECT sinh(0);
```
结果:
```
0.0
```
2. 计算 `sinh(1)` 和 `sinh(-1)`:
```sql
SELECT sinh(1) AS sinh1, sinh(-1) AS sinhNeg1;
```
结果:
```
sinh1: 1.1752011936438014
sinhNeg1: -1.1752011936438014
```
3. 计算 `sinh(2)` 和 `sinh(-2)`:
```sql
SELECT sinh(2) AS sinh2, sinh(-2) AS sinhNeg2;
```
结果:
```
sinh2: 3.62686176124242
sinhNeg2: -3.626860407847019
```

。