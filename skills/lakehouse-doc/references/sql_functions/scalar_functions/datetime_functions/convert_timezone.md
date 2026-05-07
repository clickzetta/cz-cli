### 转换时区函数 CONVERT_TIMEZONE

#### 功能描述
`CONVERT_TIMEZONE` 函数用于将一个指定的时间戳从一个时区转换到另一个时区。该函数能够处理不同类型的时间格式输入，并在必要时自动进行类型转换。

#### 语法
```sql
CONVERT_TIMEZONE(source_tz, target_tz, ts)
CONVERT_TIMEZONE(target_tz, ts)
```
- `source_tz` string : 原始时区。如果只提供两个参数，则默认使用当前会话的时区作为原始时区。
- `target_tz` string : 目标时区。
- `ts` int 或 timestamp : 时间戳。如果是整数类型，函数会自动将其转换为时间戳类型。

#### 返回值
转换后的时间戳（timestamp）。

#### 使用示例
```sql
-- 示例1：将时间戳从莫斯科时区转换到洛杉矶时区
SELECT CONVERT_TIMEZONE('Europe/Moscow', 'America/Los_Angeles', '2022-01-01 00:00:00');

-- 返回结果：2021-12-31 13:00:00

-- 示例2：将当前布鲁塞尔时区的时间戳转换到目标时区
SELECT CONVERT_TIMEZONE('Europe/Brussels', 'Asia/Shanghai', '2022-03-23 00:00:00');

-- 返回结果： 2022-03-23 07:00:00

-- 示例3：只提供目标时区，将当前会话时区的时间戳转换到东京时区
SELECT CONVERT_TIMEZONE('Asia/Tokyo', 1674681600);

-- 返回结果： 2023-01-26 06:20:00

-- 示例4：将整数类型的时间戳从北京时间转换到UTC时间
SELECT CONVERT_TIMEZONE('UTC','Asia/Shanghai', 1674681600);

-- 返回结果：2023-01-26 13:20:00 
```

#### 注意事项
- 请确保输入的时区名称有效，否则函数将返回错误。
- 当输入的时间戳格式不正确或无法识别时，函数将自动尝试进行类型转换。
- 如果输入的时间戳已经是目标时区的时间，函数将直接返回该时间戳。

通过使用 `CONVERT_TIMEZONE` 函数，您可以轻松地在不同时区之间转换时间戳，从而确保数据的准确性和一致性。