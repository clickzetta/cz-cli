### DATE_FORMAT_MYSQL 函数
```
date_format_mysql(expr, fmt)
```
#### 功能描述
DATE_FORMAT_MYSQL 函数用于将不同类型的时间戳（包括 datetime、timestamp_ltz、string 等）按照指定的格式转换为字符串形式。该函数兼容 MySQL 数据库的日期和时间格式化规则。

#### 参数说明
- `expr`: 输入的时间戳，可以是 datetime、timestamp_ltz 或者字符串格式。
- `fmt`: 描述日期时间格式的字符串，具体格式化选项请参考 MySQL 官方文档：[DATE_FORMAT()](https://dev.mysql.com/doc/refman/8.0/en/date-and-time-functions.html#function_date-format)

格式化选项说明：

| 选项 | 描述 |
| ---- | ---- |
| `%a` | 简写星期几名称（例如：Sun 到 Sat） |
| `%b` | 简写月份名称（例如：Jan 到 Dec） |
| `%c` | 月份数字（00 到 12） |
| `%D` | 月份中的天数，带英文后缀（例如：1st, 2nd, 3rd, ...） |
| `%d` | 月份中的天数，数字表示（00 到 31） |
| `%e` | 月份中的天数，数字表示（0 到 31） |
| `%f` | 微秒（000000 到 999999） |
| `%H` | 小时（00 到 23） |
| `%h` | 小时（01 到 12） |
| `%I` | 小时（01 到 12） |
| `%i` | 分钟（00 到 59） |
| `%j` | 一年中的天数（001 到 366） |
| `%k` | 小时（0 到 23） |
| `%l` | 小时（1 到 12） |
| `%M` | 月份名称（January 到 December） |
| `%m` | 月份数字（00 到 12） |
| `%p` | 上午或下午（AM 或 PM） |
| `%S` | 秒（00 到 59） |
| `%s` | 秒（00 到 59） |
| `%T` | 24小时制时间（hh:mm:ss） |
| `%v` | 周数（01 到 53），星期一作为每周的第一天；[WEEK()](https://dev.mysql.com/doc/refman/8.0/en/date-and-time-functions.html#function_week) 模式 3；与 `%x` 一起使用 |
| `%W` | 星期名称（Sunday 到 Saturday） |
| `%w` | 一周中的天数（0 表示星期日，6 表示星期六） |
| `%x` | 以星期一为每周第一天的年份，数字表示，四位数字；与 `%v` 一起使用 |
| `%Y` | 年份，数字表示，四位数字 |
| `%y` | 年份，数字表示，两位数字 |
| `%%` | 字面上的 `%` 字符 |

#### 返回结果
返回按照指定格式转换后的日期时间字符串。

#### 使用示例
1. 将当前时间转换为带有秒的字符串格式：
```sql
SELECT date_format_mysql(now(), '%Y-%m-%d %H:%i:%s');
```

2. 将时间戳转换为仅包含小时和分钟的格式：
```sql
SELECT date_format_mysql(timestamp '2023-03-22 13:45:00', '%H:%i');
```

通过以上示例，您可以看到 DATE_FORMAT_MYSQL 函数在不同场景下的应用。您可以根据需要调整 `fmt` 参数来获取您期望的日期时间格式。