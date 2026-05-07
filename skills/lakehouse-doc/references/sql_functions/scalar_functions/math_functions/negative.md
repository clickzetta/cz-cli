### NEGATIVE
```sql
negative(expr)
```
#### 功能
返回 expr 的相反数，等价于 `-expr`
#### 参数
* `expr` : 数值类型（`smallint`/`tinyint`/`int`/`bigint`/`decimal`/`double`/`float`）
#### 返回结果
返回类型与参数 `expr` 的类型一致。
#### 举例
```sql
> SELECT negative(1);
-1
```
