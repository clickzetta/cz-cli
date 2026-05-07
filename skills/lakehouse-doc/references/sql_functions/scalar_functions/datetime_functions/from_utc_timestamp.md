### FROM_UTC_TIMESTAMP 函数
```sql
from_utc_timestamp(expr, timeZone)
```
#### 功能描述
FROM_UTC_TIMESTAMP 函数用于将一个表示 UTC 时间的 timestamp 类型数据 `expr` 转换为指定时区 `timeZone` 的本地时间戳。

#### 参数说明
- `expr`: 表示 UTC 时间的 timestamp 类型数据。
- `timeZone`: 目标时区，以字符串形式表示。

#### 返回结果
转换后的本地时间戳，类型为 timestamp_ltz。

#### 使用示例
1. 将 UTC 时间 '1970-01-01' 转换为北京时间：
```sql
SELECT from_utc_timestamp('1970-01-01', 'Asia/Shanghai');
```
结果：
```
1970-01-01 08:00:00
```
2. 将多个 UTC 时间戳转换为美国东部时间：
```sql
SELECT from_utc_timestamp('2022-01-01 03:21:00', 'America/New_York');
SELECT from_utc_timestamp('2022-02-01 03:21:00', 'America/New_York');
```
结果：
```
2021-12-31 22:21:00 
2022-01-31 22:21:00    
```
3. 将当前 UTC 时间转换为澳大利亚悉尼时间：
```sql
SELECT from_utc_timestamp(current_timestamp(), 'Australia/Sydney');
```
结果：
```
2024-04-08 06:32:21 (示例时间，具体结果可能因实际时间而有所不同)
```
#### 注意事项
- 确保输入的时间戳格式正确，否则可能导致转换失败。
- 时区字符串应使用标准的时区表示方法，如 'Asia/Shanghai' 或 'America/New_York'。如果时区字符串不正确，可能导致转换结果不符合预期。
- 转换过程中，请注意夏令时的影响。部分国家和地区会在特定时期实行夏令时，这可能会导致时间有所偏差。