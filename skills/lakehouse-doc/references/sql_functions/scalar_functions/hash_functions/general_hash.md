### 通用哈希函数

#### 功能描述
本节介绍的两个通用哈希函数 `general_complexhash2` 和 `general_murmurhash3` 可用于对任意类型的数据进行哈希计算。`general_complexhash2` 根据输入数据的类型自动选择更高效的计算方法，而 `general_murmurhash3` 则采用著名的 MurmurHash3 算法进行哈希计算。

#### 使用方法
* **general_complexhash2(expr)**: 对任意类型的输入数据 `expr` 进行哈希计算，并返回一个整型结果。
* **general_murmurhash3(expr)**: 对任意类型的输入数据 `expr` 使用 MurmurHash3 算法进行哈希计算，并返回一个整型结果。

#### 参数
* **expr**: 任意类型的输入数据。

#### 返回结果
* 返回一个整型数值，表示输入数据的哈希值。

#### 示例
```sql
-- 使用 general_complexhash2 计算字符串的哈希值
> SELECT general_complexhash2('hello');
-- 结果：-5436999610281751320

-- 使用 general_murmurhash3 计算字符串的哈希值
> SELECT general_murmurhash3('hello');
-- 结果：-8014657081559513573

-- 对不同数据类型进行哈希计算
> SELECT general_complexhash2(123);
-- 结果：9208534749291869864


> SELECT general_murmurhash3(123);
-- 结果：5808450433748234714

-- 对浮点数类型进行哈希计算
> SELECT general_complexhash2(3.14);
-- 结果：-3844631488065270338


> SELECT general_murmurhash3(3.14);
-- 结果：9195935839840165100

-- 对日期类型进行哈希计算
> SELECT general_complexhash2(date'2022-01-01');
-- 结果：-8898766858233323866

-- 对时间类型进行哈希计算
> SELECT general_complexhash2(timestamp'2022-01-01 10:00:00');
-- 结果：1671608758248121621
```