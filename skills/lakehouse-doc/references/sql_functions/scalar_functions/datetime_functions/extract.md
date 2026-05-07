### 提取函数 (EXTRACT)

#### 功能描述
提取函数 `EXTRACT(field FROM source)` 用于从给定的 `source` 中提取指定的 `field` 值。该函数可以处理不同类型的日期时间表达式，包括字符串、时间戳等。

#### 参数说明
- `field` (关键词)：需要提取的日期时间字段，具体选项如下：
  - `YEAR`, `(Y, YEARS, YR, YRS)` - 年份
  - `QUARTER`, `(QTR)` - 季度 (1 - 4)
  - `MONTH`, `(MON, MONS, MONTHS)` - 月份 (1 - 12)
  - `WEEK`, `(W, WEEKS)` - 表示一年中的第几个星期。需要注意的是，星期的计算是以星期一为开始，每年的第一个星期是该年第一个包含四天或以上的星期。在 ISO 星期的计算体系中，1 月份的最初几天可能属于前一年的第 52 或 53 周；同理，12 月份的最后几天可能属于下一年的第 1 周。例如，2005-01-02 属于 2004 年的第 53 周，2012-12-31 属于 2013 年的第 1 周。
  - `DAY`, `(D, DAYS)` - 所属月份的第几天 (1 - 31)
  - `DAYOFWEEK`, `(DOW)` - 所属星期的第几天，1 对应星期日，7 对应星期六
  - `DAYOFWEEK_ISO`, `(DOW_ISO)` - 所属星期的第几天，基于ISO 8601标准，1 对应星期一，7 对应星期日
  - `DAYOFYEAR`, `(DOY)` - 在所属年份的第几天 (1 - 365/366)
  - `HOUR`, `(H, HOURS, HR, HRS)` - 小时 (0 - 23)
  - `MINUTE`, `(M, MIN, MINS, MINUTES)` - 分钟 (0 - 59)
  - `SECOND`, `(S, SEC, SECONDS, SECS)` - 秒 (0 - 59)
- `source` (日期/时间戳)：输入的日期时间表达式，可以是字符串、时间戳等。

#### 返回结果
返回结果为整数（int）。

#### 使用示例
以下为 `EXTRACT` 函数的使用示例：

```sql
-- 从字符串类型的时间戳中提取年份
SELECT EXTRACT(YEAR FROM TIMESTAMP '2019-08-12 01:00:00.123456');
-- 结果：2019

-- 从字符串类型的时间戳中提取一年中的第几个星期
SELECT EXTRACT(WEEK FROM TIMESTAMP '2019-08-12 01:00:00.123456');
-- 结果：33

-- 从字符串类型的日期中提取所属月份的第几天
SELECT EXTRACT(DAY FROM DATE '2019-08-12');
-- 结果：12

-- 从当前时间戳中提取季度
SELECT EXTRACT(QUARTER FROM CURRENT_TIMESTAMP());
-- 结果：取决于当前日期

-- 从字符串类型的日期中提取所属星期的第几天（基于ISO 8601标准）
SELECT EXTRACT(DAYOFWEEK_ISO FROM DATE '2019-08-12');
-- 结果： 1 
```

通过以上示例，可以看到 `EXTRACT` 函数在不同场景下的应用。该函数可以方便地从各种输入格式中提取所需的日期时间字段，便于进行进一步的数据分析和处理。