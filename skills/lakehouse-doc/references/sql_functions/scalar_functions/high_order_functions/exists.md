### EXISTS 函数

#### 功能描述
EXISTS 函数用于判断指定数组中是否存在满足给定条件的元素。通过传入一个 lambda 表达式，可以对数组中的每个元素进行判断。如果至少有一个元素满足条件，函数返回 `true`，否则返回 `false`。

#### 参数说明
* array: `array<T>` 类型，表示待判断的数组。
* x -> expr: 单参数形式的 lambda 表达式，x 对应 array 中的元素；expr 需要返回 boolean 类型，表示判断条件。

#### 返回类型
返回一个 `boolean` 类型的值。

#### 使用示例
1. 判断数组中是否存在小于等于 3 的元素：
<= 0);
```
结果：
```
false
```

4. 判断数组中是否存在至少一个空值（null）：
```sql
SELECT EXISTS(array(1, null, 3), x -> x is null);
结果：
```
true
```

2. 判断数组中是否存在偶数：
```sql
SELECT EXISTS(array(1, 2, 3, 4), x -> x % 2 = 0);
```
结果：
```
true
```

3. 判断数组中是否存在负数：
```sql
SELECT EXISTS(array(1, 2, 3, 4), x -> x < 0);
```
结果：
```
false
```

通过以上示例，您可以看到 EXISTS 函数在不同场景下的应用。使用 EXISTS 函数可以方便地对数组中的元素进行条件判断，从而实现更灵活的数据处理。