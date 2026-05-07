### SHIFTLEFT
```sql
shiftleft(value, n)
```
#### 功能
对整数值进行左移位操作。左移 n 位相当于乘以 2^n。该函数支持 int 和 bigint 类型。

#### 参数
* value: int 或 bigint 类型，待移位的值
* n: int 类型，移位的位数，必须大于等于 0

#### 返回结果
* 与 value 相同的类型（int 或 bigint）
* 返回左移后的结果
* 如果 value 或 n 为 NULL，则返回 NULL

#### 举例
```sql
-- int 类型左移
> SELECT shiftleft(1, 2);
4

> SELECT shiftleft(8, 2);
32

> SELECT shiftleft(0, 2);
0

-- bigint 类型左移
> SELECT shiftleft(1L, 2);
4

> SELECT shiftleft(8L, 2);
32

-- NULL 处理
> SELECT shiftleft(NULL, 2);
NULL

> SELECT shiftleft(1, NULL);
NULL

-- 负数左移
> SELECT shiftleft(-4, 2);
-16

-- 实际应用：计算 2 的幂
> SELECT shiftleft(1, 10);  -- 2^10 = 1024
1024
```

#### 说明
* 左移 n 位等价于乘以 2^n
* 对于正数：shiftleft(x, n) = x * 2^n
* 对于负数，左移操作保留符号位。
* 移位操作可能导致溢出：
  * int 类型范围：-2,147,483,648 到 2,147,483,647
  * bigint 类型范围：-9,223,372,036,854,775,808 到 9,223,372,036,854,775,807
* 如果移位后的结果超出类型范围，会发生溢出（结果不可预测）。
* 移位操作是位运算，性能优于乘法运算
* 常用于：
  * 快速计算 2 的幂次
  * 位标志和位掩码操作
  * 数据编码和解码
* 相关函数：
  * shiftright - 算术右移（保留符号位）
  * shiftrightunsigned - 逻辑右移（不保留符号位）
