### SHIFTRIGHT
```sql
shiftright(value, n)
```
#### 功能
对整数值进行算术右移位操作。算术右移会保留符号位，即负数右移后仍为负数。右移 n 位相当于除以 2^n（向下取整）。该函数支持 int 和 bigint 类型。

#### 参数
* `value`: int 或 bigint 类型，待移位的值
* `n`: int 类型，移位的位数，必须大于等于 0

#### 返回结果
* 与 value 相同的类型（int 或 bigint）
* 返回右移后的结果
* 如果 value 或 n 为 NULL，返回 NULL

#### 举例
```sql
-- int 类型右移
> SELECT shiftright(8, 2);
2

> SELECT shiftright(1, 2);
0

> SELECT shiftright(0, 2);
0

-- bigint 类型右移
> SELECT shiftright(8L, 2);
2

> SELECT shiftright(32L, 2);
8

-- NULL 处理
> SELECT shiftright(NULL, 2);
NULL

> SELECT shiftright(8, NULL);
NULL

-- 负数右移（保留符号位）
> SELECT shiftright(-4, 2);
-1

-- 实际应用：快速除以 2 的幂
> SELECT shiftright(1024, 10);  -- 1024 / 2^10 = 1
1
```

#### 说明
* shiftright 是算术右移，保留符号位
* 对于正数：shiftright(x, n) = floor(x / 2^n)
* 对于负数，算术右移保留符号位，右移后仍为负数
* 右移操作等价于整数除法（向下取整）
* 与 `shiftrightunsigned` 的区别：
  * `shiftright` 是算术右移，保留符号位
  * `shiftrightunsigned` 是逻辑右移，不保留符号位，用 0 填充最高位
* 示例：对于 -4（二进制表示为 11111111111111111111111111111100）
  * shiftright(-4, 2) = -1（保留符号位）
  * shiftrightunsigned(-4, 2) = 1073741823（用 0 填充最高位）
* 移位操作是位运算，性能优于除法运算
* 常用于：
  * 快速计算除以 2 的幂次
  * 位标志和位掩码操作
  * 数据编码和解码
* 相关函数：
  * `shiftleft` - 左移
  * `shiftrightunsigned` - 逻辑右移（不保留符号位）
