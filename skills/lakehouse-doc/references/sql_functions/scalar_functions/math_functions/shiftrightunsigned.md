### SHIFTRIGHTUNSIGNED
```sql
shiftrightunsigned(value, n)
```
#### 功能
对整数值进行逻辑右移位操作。逻辑右移不保留符号位，用 0 填充最高位，因此负数右移后会变成正数。该函数支持 int 和 bigint 类型。

#### 参数
* `value`: int 或 bigint 类型，待移位的值
* `n`: int 类型，移位的位数，必须大于等于 0

#### 返回结果
* 与 value 相同的类型（int 或 bigint）
* 返回右移后的结果
* 如果 `value` 或 `n` 为 NULL，返回 NULL

#### 举例
```sql
-- int 类型逻辑右移
> SELECT shiftrightunsigned(8, 2);
2

> SELECT shiftrightunsigned(1, 2);
0

> SELECT shiftrightunsigned(0, 2);
0

-- bigint 类型逻辑右移
> SELECT shiftrightunsigned(8L, 2);
2

> SELECT shiftrightunsigned(32L, 2);
8

-- NULL 处理
> SELECT shiftrightunsigned(NULL, 2);
NULL

> SELECT shiftrightunsigned(8, NULL);
NULL

-- 负数逻辑右移（不保留符号位，用 0 填充）
> SELECT shiftrightunsigned(-4, 2);
1073741823

-- 对比算术右移和逻辑右移
> SELECT shiftright(-4, 2), shiftrightunsigned(-4, 2);
-1	1073741823
```

#### 说明
* `shiftrightunsigned` 是逻辑右移，不保留符号位，用 0 填充最高位
* 对于正数，逻辑右移和算术右移的结果相同
* 对于负数，逻辑右移会将符号位作为普通位处理，用 0 填充最高位
* 与 `shiftright` 的区别：
  * `shiftright` 是算术右移，保留符号位
  * `shiftrightunsigned` 是逻辑右移，不保留符号位
* 示例：对于 -4（int 类型，32 位二进制表示为 `11111111111111111111111111111100`）
  * `shiftright(-4, 2)` = -1（保留符号位，结果为 `11111111111111111111111111111111`）
  * `shiftrightunsigned(-4, 2)` = 1073741823（用 0 填充，结果为 `00111111111111111111111111111111`）
* 对于 bigint 类型（64 位），处理方式相同，只是位数更多
* 常用于：
  * 无符号整数运算
  * 位掩码操作
  * 哈希计算
  * 数据编码和解码
* 相关函数：
  * `shiftleft` - 左移
  * `shiftright` - 算术右移（保留符号位）
