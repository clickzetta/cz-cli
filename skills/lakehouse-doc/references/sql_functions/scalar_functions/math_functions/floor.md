### FLOOR 函数

#### 功能描述
FLOOR 函数用于返回小于或等于给定数值表达式（expr）的最大整数。同时，可以根据需要将结果保留指定位数的小数（d）。该函数支持多种数值类型的输入，包括 float、double、decimal、tinyint、smallint、int 和 bigint。

#### 参数说明
- **expr**: 需要处理的数值表达式，可以是 float、double、decimal、tinyint、smallint、int 或 bigint 类型。
- **d** (可选): 指定结果保留的小数位数，类型为 int。支持负值，默认值为 0。

#### 返回结果
返回结果的类型与输入的 expr 类型相同。如果 expr 是 decimal 类型，返回结果的小数位数（scale）会根据指定的 d 值进行调整。

#### 使用示例
1. 计算 -0.1 的最大整数结果：
   ```sql
   SELECT FLOOR(-0.1); -- 结果为 -1
   ```
2. 计算整数 5 的最大整数结果：
   ```sql
   SELECT FLOOR(5); -- 结果为 5
   ```
3. 计算 5123.123 保留一位小数的最大整数结果：
   ```sql
   SELECT FLOOR(5123.123, 1); -- 结果为 5123.1
   ```
4. 计算 5123.123 保留负一位小数的最大整数结果：
   ```sql
   SELECT FLOOR(5123.123, -1); -- 结果为 5120
   ```
5. 对于 decimal 类型，保留两位小数的结果：
   ```sql
   SELECT FLOOR(123.456, 2); -- 结果为 123.45
   ```
6. 对于 tinyint 类型，计算最大整数结果：
   ```sql
   SELECT FLOOR(255); -- 结果为 255
   ```
7. 对于 bigint 类型，保留两位小数的结果：
   ```sql
   SELECT FLOOR(1234567890123456789, 2); -- 结果为 1234567890123456789
   ```
