### HASH_COMBINE_COMMUTATIVE
```sql
hash_combine_commutative(value1, value2, ...)
```
#### 功能
对多个值进行可交换的哈希组合。与普通的 `hash_combine` 不同，`hash_combine_commutative` 的结果不受参数顺序影响，即 `hash_combine_commutative(a, b, c)` 与 `hash_combine_commutative(c, b, a)` 的结果相同。该函数常用于需要对无序集合进行哈希计算的场景。

#### 参数
* `value1`, `value2`, ...: 任意类型，待组合哈希的值，至少需要一个参数

#### 返回结果
* `bigint` 类型
* 返回所有输入值的可交换哈希组合结果
* 结果与参数顺序无关

#### 举例
```sql
-- 参数顺序不影响结果
> SELECT hash_combine_commutative(1, 2, 3);
10777284388

> SELECT hash_combine_commutative(3, 2, 1);
10777284388


-- 用于计算 bitmap 的哈希值
> SELECT
    general_murmurhash3(bitmap_build(array(1L, 2L, 3L))),
    hash_combine_commutative(
      general_murmurhash3(3L),  -- size
      general_murmurhash3(1L),
      general_murmurhash3(2L),
      general_murmurhash3(3L)
    );
-4327490212287121842	-4327490212287121842

-- 用于计算 map 的哈希值（key-value 对的顺序不影响结果）
> SELECT general_murmurhash3(map(1, '2', 3, '4')),
         hash_combine(
           general_murmurhash3(size(map(1, '2', 3, '4'))),
           hash_combine_commutative(
             hash_combine(general_murmurhash3(1), general_murmurhash3('2')),
             hash_combine(general_murmurhash3(3), general_murmurhash3('4'))
           )
         );
-7258238779908172255	-7258238779908172255
```

#### 说明
* `hash_combine_commutative` 是可交换的（commutative），即参数顺序不影响结果
* 与 `hash_combine` 的区别：`hash_combine` 考虑参数顺序，`hash_combine_commutative` 不考虑参数顺序
* 常用于计算无序数据结构（如 `set`、`bitmap`、`map`）的哈希值
* 该函数与 `general_murmurhash3` 配合使用，可以实现复杂数据结构的哈希计算
* 适用于需要对集合进行去重或比较的场景，因为集合中元素的顺序通常不重要
