### DATEADD 函数
```
timestampadd(unit, count, ts)
dateadd(unit, count, ts)
```
#### 功能描述
`TIMESTAMPADD` 的别名函数用于在给定的时间戳 `ts` 上增加或减少一定数量的指定时间单位 `unit`。如果 `count` 为正数，则表示增加；若为负数，则表示减少。

可接受的时间单位 `unit` 包括（不区分大小写）：
- MICROSECOND（微秒）
- MILLISECOND（毫秒）
- SECOND（秒）
- MINUTE（分）
- HOUR（时）
- DAY（天）
- DAYOFYEAR（一年中的第几天）
- WEEK（周）
- MONTH（月）
- QUARTER（季度）
- YEAR（年）

#### 参数说明
- `unit`: timestamp_ltz 类型，表示要添加的时间单位。
- `count`: bigint 类型，表示要添加或减少的数量。
- `ts`: timestamp_ltz 类型，表示当前时间戳。

#### 返回类型
返回一个新的 timestamp_ltz 类型的时间戳。

#### 使用示例
1. 增加 1 年：
   ```sql
   SELECT dateadd(YEAR, 1, '2020-10-10 01:02:03');
   -- 结果：2021-10-10 01:02:03 
   ```
2. 减少 30 天：
   ```sql
   SELECT dateadd(DAY, -30, '2020-10-10 01:02:03');
   -- 结果：2020-09-10 01:02:03
   ```
3. 增加 12 个小时：
   ```sql
   SELECT dateadd(HOUR, 12, '2020-10-10 01:02:03');
   -- 结果：2020-10-10 13:02:03
   ```
4. 减少 3 个月：
   ```sql
   SELECT dateadd(MONTH, -3, '2020-10-10 01:02:03');
   -- 结果：2020-07-10 01:02:03
   ```
5. 增加 2 毫秒：
   ```sql
   SELECT dateadd(MILLISECOND, 2, '2020-10-10 01:02:03.999');
   -- 结果：2020-10-10 01:02:04.001
   ```

### 注意事项
- 当处理时间戳时，确保传入的参数格式正确，否则可能导致函数执行失败。
- 在进行时间单位转换时，注意闰年、月份天数等特殊情况，以免得到错误的结果。
- 请根据实际需求选择合适的时间单位和增量，以避免不必要的时间误差。