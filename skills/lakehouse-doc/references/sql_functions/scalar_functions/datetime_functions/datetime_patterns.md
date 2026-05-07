### DATETIME PATTERNS

#### 符号


|符号|含义|格式|距离|
|---|---|---|---|
|**G**|era|text|AD; Anno Domini|
|**y**|year|year|2020; 20|
|**D**|day-of-year|number(3)|189|
|**M**|month-of-year|month|7; 07; Jul; July|
|**d**|day-of-month|number(2)|28|
|**Q**|quarter-of-year|number/text|3; 03; Q3; 3rd quarter|
|**a**|am-pm-of-day|am-pm|PM|
|**h**|clock-hour-of-am-pm (1-12)|number(2)|12|
|**K**|hour-of-am-pm (0-11)|number(2)|0|
|**k**|clock-hour-of-day (1-24)|number(2)|0|
|**H**|hour-of-day (0-23)|number(2)|0|
|**m**|minute-of-hour|number(2)|30|
|**s**|second-of-minute|number(2)|55|
|**S**|fraction-of-second|fraction|978|
|**V**|time-zone ID|zone-id|America/Los_Angeles; Z; -08:30|
|**z**|time-zone name|zone-name|Pacific Standard Time; PST|
|**O**|localized zone-offset|offset-O|GMT+8; GMT+08:00; UTC-08:00;|
|**X**|zone-offset ‘Z’ for zero|offset-X|Z; -08; -0830; -08:30; -083015; -08:30:15;|
|**x**|zone-offset|offset-x|+0000; -08; -0830; -08:30; -083015; -08:30:15;|
|**Z**|zone-offset|offset-Z|+0000; -0800; -08:00;|
|**’‘**|single quote|literal|’|


#### 部分符号解释
年份:
- yyyy 四位数年份数字表示，例如 2022

月份:
- M 单位数月份数字表示，例如 3、12
- MM 双位数月份表示，例如 03、12

所在当月天数:
- d 单位数当月日期表示，例如 5、20
- dd 双位数当月日期表示，例如 05、20

小时，24小时制:
- H 单位数24小时制小时表示，例如 1、23
- HH 双位数24小时制小时表示，例如 01、23

分钟:
- m 单位数分钟表示，例如 4、59
- mm 双位数分钟表示，例如 04、59

秒:
- s 单位数秒钟表示，例如 8、59
- ss 双位数秒钟表示，例如 08、59

毫秒/微秒:
- S 可以有 1-9 位，从左到右依次为 毫秒(3位)，微秒(3位)，纳秒(3位)。CZ 对于时间戳精度目前只支持微秒，因此在解析时间字符串时纳秒会被丢弃，生成时间字符串时纳秒部分则会置零。当 S 位数不足 9 位时，则会从右边开始降低精度。

示例:
- yyyy-MM-dd HH:mm:ss.SSSS: 2022-01-10 10:05:02.1232
- yyyy/M/d H:m:s.SSSS: 2022/1/10 10:5:2.12
- yyyy'你好世界yMdH'-MM-dd HH:mm:ss.SSSS: 2022你好世界yMdH-01-10 10:05:02.1232
