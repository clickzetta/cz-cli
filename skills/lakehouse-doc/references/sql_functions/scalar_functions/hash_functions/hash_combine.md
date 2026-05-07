### HASH_COMBINE 和 HASH_COMBINE_COMMUTATIVE 函数

#### 功能描述
`hash_combine` 函数用于将多个哈希值 h1, h2, ..., hN 组合成一个新的哈希值。该函数的特点是组合值的顺序会影响最终的哈希值。

`hash_combine_commutative` 函数与 `hash_combine` 类似，也用于将多个哈希值 h1, h2, ..., hN 组合成一个新的哈希值。不同之处在于，该函数的特点是组合值的顺序不会影响最终的哈希值，即满足交换律。

#### 参数说明
* `h1`, `h2`, ..., `hN`: bigint 类型，表示要组合的哈希值。

#### 返回结果
返回一个 `bigint` 类型的值，表示组合后的哈希值。

#### 使用示例
以下示例展示了如何使用 `hash_combine` 和 `hash_combine_commutative` 函数：

```sql
-- 使用 hash_combine 函数
SELECT hash_combine(1, 2, 3) AS hash_combine_result1;
-- 结果：175247765312

SELECT hash_combine(3, 2, 1) AS hash_combine_result2;
-- 结果：175247756320

-- 使用 hash_combine_commutative 函数
SELECT hash_combine_commutative(1, 2, 3) AS hash_commutative_result1;
-- 结果：10777284388

SELECT hash_combine_commutative(3, 2, 1) AS hash_commutative_result2;
-- 结果：10777284388
```

从上述示例中可以看出，`hash_combine` 函数在组合值的顺序改变时，结果也会发生变化；而 `hash_combine_commutative` 函数在组合值的顺序改变时，结果保持不变。

#### 注意事项
* 当需要组合的哈希值数量较少时，可以使用这两个函数。但如果需要合并大量的哈希值，建议使用其他方法，以避免性能问题。
* 在实际应用中，可以根据具体需求选择合适的函数。如果对组合值的顺序有要求，可以使用 `hash_combine` 函数；如果对顺序无要求，可以使用 `hash_combine_commutative` 函数。