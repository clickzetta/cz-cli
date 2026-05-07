### TRANSFORM 函数

#### 功能描述
TRANSFORM 函数用于根据给定的 lambda 表达式对数组（array）中的元素进行转换。该函数支持两种形式的 lambda 表达式：单参数形式和双参数形式（包含元素索引）。

#### 参数说明
- `array`: 输入的数组，类型为 `array<T>`，其中 T 可以是任意数据类型。
- `x -> expr`: 单参数形式的 lambda 表达式，`x` 代表数组中的元素，`expr` 为根据 `x` 计算得到的新值，返回值类型无限制。
- `(x, i) -> expr`: 双参数形式的 lambda 表达式，`x` 代表数组中的元素，`i` 代表元素的索引（从 0 开始计数），`expr` 为根据 `x` 和 `i` 计算得到的新值，返回值类型无限制。

#### 返回值
返回一个新的数组，类型为 `array<U>`，其中 U 是 lambda 表达式返回值的类型。

#### 使用示例

1. 计算数组中每个元素的平方并返回结果数组：
   ```sql
   SELECT transform(array(1, 2, 3), x -> x * x);
   -- 输出结果：[1, 4, 9]
   ```

2. 将数组中的字符串元素转换为大写，并返回结果数组：
   ```sql
   SELECT transform(array('hello', 'world'), x -> upper(x));
   -- 输出结果：['HELLO', 'WORLD']
   ```

3. 根据数组元素的索引和值计算新的数组，其中每个元素的值是其索引与值之和：
   ```sql
   SELECT transform(array(2, 1, 3), (x, i) -> x + i);
   -- 输出结果：[2, 2, 5]
   ```

4. 对数组中的字符串进行拆分，并返回结果数组：
   ```sql
   SELECT transform(array('hello,world', NULL, '1,2,3'), x -> split(x, ','));
   -- 输出结果：[["hello","world"],null,["1","2","3"]]
   ```

5. 将数组中的每个数值乘以 2 并返回结果数组：
   ```sql
   SELECT transform(array(1, 3, 5), x -> x * 2);
   -- 输出结果：[2, 6, 10]
   ```

#### 注意事项
- 请确保 lambda 表达式中的参数名称与实际传入的参数相匹配。
- 在使用双参数形式的 lambda 表达式时，请注意元素索引是从 0 开始的。