### TIMESTAMPADD 函数

#### 概述
TIMESTAMPADD 函数（别名：DATEADD）用于在给定的时间戳（ts）上增加或减少指定数量（count）的单位（unit）。如果 count 为正数，则在时间戳上增加相应的单位；如果 count 为负数，则在时间戳上减少相应的单位。

#### 支持的时间单位
时间单位（unit）可以取以下关键字（不区分大小写）：
- MICROSECOND（微秒）
- MILLISECOND（毫秒）
- SECOND（秒）
- MINUTE（分钟）
- HOUR（小时）
- DAY（天）
- DAYOFYEAR（一年中的第几天）
- WEEK（周）
- MONTH（月）
- QUARTER（季度）
- YEAR（年）

#### 函数参数
- unit: timestamp_ltz 类型，表示要添加或减去的时间单位。
- count: bigint 类型，表示要添加或减去的数量。
- ts: timestamp_ltz 类型，表示当前时间戳。

#### 返回值
返回一个新的时间戳（timestamp_ltz）。

#### 使用示例
1. 在时间戳 '2020-10-10 01:02:03' 上增加 1 年：
   ```sql
   SELECT TIMESTAMPADD(YEAR, 1, '2020-10-10 01:02:03');
   ```
   结果：`2021-10-10 01:02:03`

2. 在时间戳 '2020-10-10 01:02:03' 上减少 30 分钟：
   ```sql
   SELECT TIMESTAMPADD(MINUTE, -30, '2020-10-10 01:02:03');
   ```
   结果：`2020-10-10 00:32:03`

3. 在时间戳 '2021-01-01 12:00:00' 上增加 100 天：
   ```sql
   SELECT TIMESTAMPADD(DAY, 100, '2021-01-01 12:00:00');
   ```
   结果：`2021-04-10 12:00:00`

4. 在时间戳 '2020-10-10 01:02:03' 上增加 2 个月：
   ```sql
   SELECT TIMESTAMPADD(MONTH, 2, '2020-10-10 01:02:03');
   ```
   结果：`2020-12-10 01:02:03`

5. 在时间戳 '2020-10-10 01:02:03' 上增加 1 季度：
   ```sql
   SELECT TIMESTAMPADD(QUARTER, 1, '2020-10-10 01:02:03');
   ```
   结果：`2021-01-10 01:02:03`

通过使用 TIMESTAMPADD 函数，您可以轻松地对时间戳进行加减操作，以满足不同的业务需求。