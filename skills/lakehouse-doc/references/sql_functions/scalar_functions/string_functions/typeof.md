### TYPEOF
```sql
typeof(expr)
```
#### 功能
返回表达式的数据类型。该函数用于查询表达式或列的类型信息，在动态 SQL 和类型检查场景中非常有用。

#### 参数
* `expr`：任意类型的表达式

#### 返回结果
* string 类型
* 返回表达式的数据类型名称
* 对于基本类型，返回类型名称（如 'int', 'string', 'boolean'）
* 对于复杂类型，返回完整的类型定义（如 `array<...>`, `map<...>`, `struct<...>`）

#### 举例
```sql
-- 基本类型
> SELECT typeof(true);
boolean

> SELECT typeof(1);
int

> SELECT typeof(1.0);
decimal(2,1)

> SELECT typeof("1");
string

-- 复杂类型
> SELECT typeof(array(1, 2, 3));
array<int>

> SELECT typeof(map(1, 2));
map<int,int>

> SELECT typeof(struct(1, 2, 3));
struct<col1:int,col2:int,col3:int>

```

#### 说明
* typeof 函数返回的是类型名称字符串，而不是类型对象
* 对于 decimal 类型，返回完整的精度信息，如 'decimal(10,2)'
* 对于复杂类型（array、map、struct），返回完整的嵌套类型定义
* `struct` 类型的字段名默认为 `col1`、`col2`、`col3` 等
* 该函数在编译时确定类型，不会在运行时改变
* 常用场景：
  * 调试和诊断
  * 生成类型相关的元数据
* 注意：`TYPEOF` 只返回类型信息，不包含 NULL 约束信息
* 该函数对性能影响很小，因为类型信息在编译时就已确定