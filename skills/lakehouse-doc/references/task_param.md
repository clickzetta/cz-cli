# 任务参数

> 特别注意：参数功能目前处于灰度阶段，完整的功能仅对部分客户开放使用。可使用文末的方式来验证是否支持。

## 什么是任务参数

### 为什么需要参数？

在日常数据开发中，我们经常遇到这样的场景：

* 每天处理前一天的数据：`WHERE dt = '2023-09-21'`
* 每月统计上月数据：`WHERE month = '2023-08'`
* 查询特定城市数据：`WHERE city = 'Shanghai'`

如果把日期、城市等信息写死在代码中，任务运行时就无法动态适应变化。**任务参数**就是为了解决这个问题而设计的。

### 参数的核心价值

* **动态替换**：任务运行时自动替换参数值。
* **灵活配置**：支持常量、时间表达式、系统参数。
* **复用性强**：一次定义，多处使用。
* **易于维护**：修改参数无需改动代码逻辑。

### 基本概念

| 分类   | 概念名称     | 含义                                                 | 示意                                   |
| ---- | -------- | -------------------------------------------------- | ------------------------------------ |
| 参数定义 | 自定义参数    | 指用户在代码中，自定义输入，引用的参数。其格式固定为 ${自定义参数名}               | ${my\_param}                         |
| 参数赋值 | 常量       | 指固定不变的取值，比如字符串和数字，用于给自定义参数赋值                       | abcd 或 1234                          |
| 参数赋值 | 系统内置参数   | 指由系统内置的一系列参数表达式，用来方便用户获取需要通过计算获取的动态的信息，比如任务实例的计划时间 | sys\_plan\_datetime                  |
| 参数赋值 | 系统内置时间函数 | 指由系统内置的一系列函数表达式，用于对时间做一些常用的转换计算                    | add\_months(yyyy-MM-dd HH\:mm\:ss,N) |

## 快速开始

### 三步快速上手

**第1步：在代码中使用参数**

```SQL
SELECT * FROM sales_table WHERE city = '${city}' AND dt = '${yesterday}';
```

**第2步：配置参数取值**
点击"参数"按钮，系统会自动识别出 `city` 和 `yesterday` 两个参数，为它们赋值：

* `city` = `Shanghai`
* `yesterday` = `$[yyyy-MM-dd, -1d]`

**第3步：运行验证**
点击“运行”，系统会将参数替换后执行：

```SQL
SELECT * FROM sales_table WHERE city = 'Shanghai' AND dt = '2023-09-21';  

-- 假设今天是2023-09-22
```

### 关键要点

* 参数格式固定为：`${参数名}`。
* 参数名只能包含字母、数字、下划线。
* 参数要在定义中使用内置参数或时间表达式等赋值，然后在代码中引用。不能在代码中直接引用内置参数。
* 参数替换时，只替换 `${}` 内的内容。
* 如需在SQL中加引号，需自行添加，比如：`'${city}'`。

## 参数类型与作用域

系统提供两种参数类型，支持不同的使用场景：

### 任务参数

**特点**：

* 作用范围：仅当前任务
* 使用场景：任务特定的配置

**适用情况**：

* 单个任务独有的参数
* 需要精细控制的场景
* 临时性的参数配置

**创建方式**：
方式一：在脚本中输入 ${自定义参数} 后，系统会自动将自定义参数添加至「参数」弹窗内。
方式二：点击「参数」按钮，在弹窗内输入信息。

![](.topwrite/assets/image_1740658949338.png =700)

| 配置项  | 说明           | 示例                           |
| ---- | ------------ | ---------------------------- |
| 参数名称 | 参数的唯一标识      | city、yesterday               |
| 取值来源 | 选择"任务"或"任务组" | 任务                           |
| 参数取值 | 参数的实际值       | Shanghai、$\[yyyy-MM-dd, -1d] |
| 加密取值 | 勾选后取值以密文显示   | 用于密码等敏感信息                    |
| 是否忽略 | 勾选后不进行参数替换   | 将 ${var} 作为普通文本              |

**示例**：
```SQL
-- 在某个具体任务中使用

SELECT * FROM table WHERE status = '${task_status}';
```

### 任务组参数

**特点**：

* 作用范围：任务组内所有任务
* 使用场景：多任务共享的配置

**适用情况**：

* 多个任务共用的参数（如项目代码、环境标识）
* 全局性的配置（如数据库名称）
* 需要统一管理的参数

**创建方式**：
在任务组页面点击「参数」，在弹框中点击「新建」，填写参数名称、参数值。

![](/.topwrite/assets/image_1760699887513.png =680)

如果要在具体任务中使用任务组参数，需要在任务参数定义的取值来源中做显式切换，指明该参数取值来源于任务组。

![](/.topwrite/assets/image_1760699557999.png =680)

**示例**：
```SQL
-- 任务组参数：db_name = warehouse_prod

-- 任务A
SELECT * FROM ${db_name}.table_a;

-- 任务B
SELECT * FROM ${db_name}.table_b;

-- 两个任务都使用同一个db_name参数
```

## 参数两种配置方法

### 方法一：基于代码自动识别

直接在脚本中输入 `${参数名}`，系统会自动识别并添加到参数列表。

**优点**：快速、直观，参数名不易拼写错误。
```SQL
-- 输入以下代码
SELECT * FROM table WHERE city = '${city}' AND dt = '${dt}';
-- 系统自动识别出 city 和 dt 两个参数
```

### 方法二：手动创建后再使用

点击"参数"按钮，在弹窗中点击"新建"，手动输入参数信息。

**优点**：可以提前定义参数，适合规划性强的场景。

## 参数在不同运行方式下的作用效果

### 临时运行（点击"运行"按钮）

* 弹窗提示输入参数值

  ![](/.topwrite/assets/image_1761284431760.png =680)

* 本次运行生效，不影响已保存的参数配置

* 适合调试和验证

### 周期调度运行（自动定时调度）

* 使用已保存的参数配置
* 根据调度时间动态计算参数值
* 适合生产环境

## 系统内置参数

系统预置了一系列常用参数，可直接用于参数赋值，无需手动计算。

请特别注意内置参数无法在代码中被直接引用。

### 日期时间类参数

| 参数名                  | 格式                    | 说明            | 示例（基准时间2023-09-22 18:00:00） |
| -------------------- | --------------------- | ------------- | --------------------------- |
| bizdate              | yyyyMMdd              | 业务日期（计划时间-1天） | 20230921                    |
| sys\_biz\_day        | yyyy-MM-dd            | 业务日期          | 2023-09-21                   |
| sys\_biz\_datetime   | yyyy-MM-dd HH\:mm\:ss | 业务时间          | 2023-09-21 18:00:00             |
| sys\_plan\_day       | yyyy-MM-dd            | 计划日期          | 2023-09-22                   |
| sys\_plan\_datetime  | yyyy-MM-dd HH\:mm\:ss | 计划时间          | 2023-09-22 18:00:00             |
| sys\_plan\_timestamp | 13位时间戳                | 计划时间戳（毫秒）     | 1695463200000               |

### 任务信息类参数

| 参数名              | 说明    | 示例         | 注意事项     |
| ---------------- | ----- | ---------- | -------- |
| sys\_task\_id    | 任务ID  | 1002       | 仅调度运行时支持 |
| sys\_task\_name  | 任务名称  | demo\_task | 仅调度运行时支持 |
| sys\_task\_owner | 任务负责人 | UAT\_TEST  | 仅调度运行时支持 |

### 使用示例

```SQL
-- 示例1：使用业务日期
SELECT * FROM table WHERE dt = '${dt}';
-- 参数配置：dt = sys_biz_day
-- 调度时间2023-09-22，实际执行：WHERE dt = '2023-09-21'

-- 示例2：使用计划时间戳
SELECT * FROM table WHERE create_time >= ${start_ts};
-- 参数配置：start_ts = sys_plan_timestamp
-- 结果：WHERE create_time >= 1695463200000

-- 示例3：Python任务中使用
task_id = '${task_id}'
print(f"当前任务ID: {task_id}")
-- 参数配置：task_id = sys_task_id
```

### 使用建议

1. **业务日期场景**：优先使用 `bizdate` 或 `sys_biz_day`
2. **需要时分秒**：使用 `sys_biz_datetime` 或 `sys_plan_datetime`
3. **时间戳计算**：使用 `sys_plan_timestamp`
4. **审计日志**：使用 `sys_task_*` 系列参数记录任务信息

***

## 时间表达式详解

时间表达式是参数系统的核心功能，支持灵活的时间格式化和偏移计算。

### 基础语法

```Plain
$[时间格式]                    # 基本格式化
$[时间格式, 偏移量]             # 带偏移量
$[时间格式, 偏移1, 偏移2, ...]  # 多个偏移量
```

### 时间格式元素

时间表达式遵循 **ISO-8601 标准**，严格区分大小写。

| 元素   | 含义             | 示例     |
| ---- | -------------- | ------ |
| yyyy | 四位年份           | 2023   |
| yy   | 两位年份           | 23     |
| MM   | 两位月份（01-12）    | 9      |
| dd   | 两位日期（01-31）    | 22     |
| HH   | 24小时制小时（00-23） | 18     |
| mm   | 分钟（00-59）      | 59     |
| ss   | 秒（00-59）       | 49     |
| .SSS | 毫秒             | 0.377  |
| ZZ   | 时区             | +08:00 |

### 常用格式组合

```SQL
$[yyyy-MM-dd]                         → 2023-09-22
$[yyyyMMdd]                           → 20230922
$[yyyy/MM/dd]                         → 2023/09/22
$[yyyy-MM-dd HH:mm:ss]                → 2023-09-22 18:00:00
$[yyyyMMddHHmmss]                     → 20230922180000
$[HH:mm:ss]                           → 18:00:00
$[yyyy-MM-dd HH:mm:ss.SSSZZ]          → 2023-09-22 18:00:00.377+08:00
```

### 常见错误

```SQL
❌ $[YYYY-MM-DD]           # 大写Y不支持
❌ $[yyyy-mm-dd]           # 小写m是分钟不是月份
❌ $[yyyy-MM-dd hh:mm:ss]  # 小写h是12小时制
✅ $[yyyy-MM-dd HH:mm:ss]  # 正确写法
```

### 时间偏移量

支持对时间进行增减操作，使用直观的单位缩写。

| 单位 | 缩写  | 全称                | 示例    |
| -- | --- | ----------------- | ----- |
| 毫秒 | ms  | milli/millisecond | 400ms |
| 秒  | s   | sec/second        | 400s  |
| 分钟 | m   | min/minute        | 3m    |
| 小时 | h   | hour              | 1h    |
| 天  | d   | day               | 2d    |
| 月  | mon | month             | 1mon  |
| 年  | y   | year              | -1y   |

### 偏移量示例

```SQL
-- 单个偏移量
$[yyyy-MM-dd, -1d]                           → 昨天
$[yyyy-MM-dd, 1d]                            → 明天
$[yyyy-MM-dd, -1mon]                         → 上个月今天
$[yyyy-MM-dd, -1y]                           → 去年今天
$[HH:mm:ss, -1h]                             → 1小时前
$[HH:mm:ss, 30m]                             → 30分钟后

-- 多个偏移量（按顺序依次计算）
$[yyyy-MM-dd, -1y, -1mon, -1d]               → 去年上个月昨天
$[yyyy-MM-dd HH:mm:ss, -1d, -2h, -30m]       → 昨天减2小时再减30分钟
$[yyyyMMdd, 1mon, -7d]                       → 下月退7天
```

### 完整示例

假设当前计划时间为：**2023-09-22 18:30:00**

```SQL
-- 基础格式
SELECT '${today}' as today;
-- 参数配置：today = $[yyyy-MM-dd]
-- 结果：2023-09-22

-- 昨天
SELECT '${yesterday}' as yesterday;
-- 参数配置：yesterday = $[yyyy-MM-dd, -1d]
-- 结果：2023-09-21

-- 上月同一天
SELECT '${last_month}' as last_month;
-- 参数配置：last_month = $[yyyy-MM-dd, -1mon]
-- 结果：2023-08-22

-- 去年昨天
SELECT '${last_year_yesterday}' as last_year_yesterday;
-- 参数配置：last_year_yesterday = $[yyyy-MM-dd, -1y, -1d]
-- 结果：2022-09-21

-- 时分秒
SELECT '${current_time}' as current_time;
-- 参数配置：current_time = $[HH:mm:ss]
-- 结果：18:30:00

-- 1小时前
SELECT '${one_hour_ago}' as one_hour_ago;
-- 参数配置：one_hour_ago = $[HH:mm:ss, -1h]
-- 结果：17:30:00
```

***

## 内置时间函数

除了时间表达式，系统还提供了丰富的时间函数，用于处理更复杂的时间计算场景。

### 月份相关函数

#### `first_day_of_month()` - 当月第一天

**语法**：

```Plain
first_day_of_month()                        # 默认格式 yyyy-MM-dd
first_day_of_month(format)                  # 指定格式
first_day_of_month(format, duration)        # 带偏移量
```

**示例**：
```SQL
-- 当月第一天
SELECT '${month_start}' as month_start;
-- 参数配置：month_start = first_day_of_month()
-- 假设当前2023-09-22，结果：2023-09-01

-- 上月第一天
SELECT '${last_month_start}' as last_month_start;
-- 参数配置：last_month_start = first_day_of_month('yyyy-MM-dd', '-1mon')
-- 结果：2023-08-01

-- 自定义格式
SELECT '${month_start_yyyymmdd}' as month_start_yyyymmdd;
-- 参数配置：month_start_yyyymmdd = first_day_of_month('yyyyMMdd')
-- 结果：20230901
```

#### `last_day_of_month()` - 当月最后一天

**语法**：

```Plain
last_day_of_month()                         # 默认格式 yyyy-MM-dd
last_day_of_month(format)                   # 指定格式
last_day_of_month(format, duration)         # 带偏移量
```

**示例**：
```SQL
-- 当月最后一天
SELECT '${month_end}' as month_end;
-- 参数配置：month_end = last_day_of_month()
-- 假设当前2023-09-22，结果：2023-09-30

-- 上月最后一天
SELECT '${last_month_end}' as last_month_end;
-- 参数配置：last_month_end = last_day_of_month('yyyy-MM-dd', '-1mon')
-- 结果：2023-08-31

-- 用于月报统计
SELECT * FROM table WHERE dt BETWEEN '${month_start}' AND '${month_end}';
-- month_start = first_day_of_month()
-- month_end = last_day_of_month()
```

### 周相关函数

系统中**周一为每周第一天，周日为最后一天**。

#### `first_day_of_week()` - 当周第一天（周一）

**语法**：

```Plain
first_day_of_week()                         # 默认格式 yyyy-MM-dd
first_day_of_week(format)                   # 指定格式
first_day_of_week(format, duration)         # 带偏移量
```

**示例**：

```SQL
-- 本周一
SELECT '${week_start}' as week_start;
-- 参数配置：week_start = first_day_of_week()
-- 假设当前2023-09-22(周五)，结果：2023-09-18

-- 上周一
SELECT '${last_week_start}' as last_week_start;
-- 参数配置：last_week_start = first_day_of_week('yyyy-MM-dd', '-1w')
-- 结果：2023-09-11
```

#### `last_day_of_week()` - 当周最后一天（周日）

**语法**：

```Plain
last_day_of_week()                          # 默认格式 yyyy-MM-dd
last_day_of_week(format)                    # 指定格式
last_day_of_week(format, duration)          # 带偏移量
```

**示例**：
```SQL
-- 本周日
SELECT '${week_end}' as week_end;
-- 参数配置：week_end = last_day_of_week()
-- 假设当前2023-09-22(周五)，结果：2023-09-24

-- 上周日
SELECT '${last_week_end}' as last_week_end;
-- 参数配置：last_week_end = last_day_of_week('yyyy-MM-dd', '-1w')
-- 结果：2023-09-17

-- 用于周报统计
SELECT * FROM table WHERE dt BETWEEN '${week_start}' AND '${week_end}';
-- week_start = first_day_of_week()
-- week_end = last_day_of_week()
```

#### `day_of_week()` - 返回是周几

**语法**：

```Plain
day_of_week()                               # 今天是周几
day_of_week(duration)                       # 偏移后是周几
```

**返回值**：整数 1-7（1=周一，7=周日）

**示例**：
```SQL
-- 判断今天是周几
SELECT ${weekday} as weekday;
-- 参数配置：weekday = day_of_week()
-- 假设今天是2023-09-25（周一），结果：1

-- 昨天是周几
SELECT ${yesterday_weekday} as yesterday_weekday;
-- 参数配置：yesterday_weekday = day_of_week('-1d')
-- 结果：7（周日）

-- Python中使用
weekday = ${weekday}
if weekday == 1:
    print("今天是周一")
-- 参数配置：weekday = day_of_week()
```

#### `get_day_of_week()` - 获取指定周几的日期

**语法**：

```Plain
get_day_of_week(format, whichDay)                      # 本周的周几
get_day_of_week(format, whichDay, duration)            # 偏移后那周的周几
```

**参数说明**：

* `format`：返回日期的格式
* `whichDay`：1-7，表示周一到周日
* `duration`：可选，时间偏移量

**示例**：
```SQL
-- 本周二
SELECT '${this_tuesday}' as this_tuesday;
-- 参数配置：this_tuesday = get_day_of_week('yyyy-MM-dd', 2)
-- 假设当前2023-09-22（周五），结果：2023-09-19

-- 上周三
SELECT '${last_wednesday}' as last_wednesday;
-- 参数配置：last_wednesday = get_day_of_week('yyyy-MM-dd', 3, '-1w')
-- 结果：2023-09-13-- 下周五SELECT '${next_friday}' as next_friday;
-- 参数配置：next_friday = get_day_of_week('yyyy-MM-dd', 5, '1w')
-- 结果：2023-09-29

-- 昨天所在周的周二
SELECT '${tuesday_of_yesterday_week}' as tuesday_of_yesterday_week;
-- 参数配置：tuesday_of_yesterday_week = get_day_of_week('yyyy-MM-dd', 2, '-1d')
-- 假设今天2023-09-25（周一），昨天2023-09-24（周日），昨天所在周是上周
-- 结果：2023-09-19
```

#### `week_of_month()` - 本月第几周

**语法**：

```Plain
week_of_month()                             # 今天在本月第几周
week_of_month(duration)                     # 偏移后在当月第几周
```

**返回值**：整数，表示在当月的第几周

**示例**：
```SQL
-- 今天是本月第几周
SELECT ${week_num} as week_num;
-- 参数配置：week_num = week_of_month()
-- 假设今天2023-09-22，结果：4（第4周）

-- 上月今天是第几周
SELECT ${last_month_week} as last_month_week;
-- 参数配置：last_month_week = week_of_month('-1mon')
```

#### `week_of_year()` - 本年第几周

**语法**：

```Plain
week_of_year()                              # 今天在本年第几周
week_of_year(duration)                      # 偏移后在当年第几周
```

**返回值**：整数，表示在当年的第几周

**示例**：
```SQL
-- 今天是本年第几周
SELECT ${week_of_year} as week_of_year;
-- 参数配置：week_of_year = week_of_year()
-- 假设今天2023-09-22，结果：38（第38周）
-- 去年今天是第几周SELECT ${last_year_week} as last_year_week;
-- 参数配置：last_year_week = week_of_year('-1y')
```

### 时间戳函数

#### `timestamp()` - 毫秒时间戳

**语法**：

```Plain
timestamp()                                 # 当前计划时间戳
timestamp(offset1, offset2, ...)            # 带偏移量的时间戳
```

**返回值**：13位毫秒时间戳

**示例**：
```SQL
-- 当前时间戳
SELECT ${current_ts} as current_ts;
-- 参数配置：current_ts = timestamp()
-- 假设当前2023-09-22 18:00:00，结果：1695463200000

-- 昨天此刻时间戳
SELECT ${yesterday_ts} as yesterday_ts;
-- 参数配置：yesterday_ts = timestamp(-1d)
-- 结果：1695376800000

-- 一周前减2小时的时间戳
SELECT ${ts} as ts;
-- 参数配置：ts = timestamp(-1w, -2h)
```

#### `biz_timestamp()` - 业务时间戳（基于00:00:00）

**语法**：

```Plain
biz_timestamp()                             # 今天00:00:00时间戳
biz_timestamp(offset1, offset2, ...)        # 带偏移量
```

**返回值**：13位毫秒时间戳，基于当天00:00:00计算

**示例**：
< ${end} |
| 审计日志    | sys\_plan\_datetime                              | 记录任务执行时间                             |

***

## 快速参考表

### 常用时间参数速查

| 需求     | 参数配置                                         | 示例结果（基准2023-09-22） |
| ------ | -------------------------------------------- | ------------------ |
| 今天     | $\[yyyy-MM-dd] 或 sys\_plan\_day              | 2023/9/22          |
| 昨天     | $\[yyyy-MM-dd, -1d] 或 sys\_biz\_day          | 2023/9/21          |
| 明天     | $\[yyyy-MM-dd, 1d]                           | 2023/9/23          |
| 上周同一天  | $\[yyyy-MM-dd, -7d]                          | 2023/9/15          |
| 上月同一天  | $\[yyyy-MM-dd, -1mon]                        | 2023/8/22          |
| 去年同一天  | $\[yyyy-MM-dd, -1y]                          | 2022/9/22          |
| 本月第一天  | first\_day\_of\_month()                      | 2023/9/1           |
| 本月最后一天 | last\_day\_of\_month()                       | 2023/9/30          |
| 上月第一天  | first\_day\_of\_month('yyyy-MM-dd', '-1mon') | 2023/8/1           |
| 上月最后一天 | last\_day\_of\_month('yyyy-MM-dd', '-1mon')  | 2023/8/31          |
| 本周一    | first\_day\_of\_week()                       | 2023/9/18          |
| 本周日    | last\_day\_of\_week()                        | 2023/9/24          |
| 上周一    | first\_day\_of\_week('yyyy-MM-dd', '-1w')    | 2023/9/11          |
| 上周日    | last\_day\_of\_week('yyyy-MM-dd', '-1w')     | 2023/9/17          |
| 本周二    | get\_day\_of\_week('yyyy-MM-dd', 2)          | 2023/9/19          |
| 上周三    | get\_day\_of\_week('yyyy-MM-dd', 3, '-1w')   | 2023/9/13          |
| 去年昨天   | $\[yyyy-MM-dd, -1y, -1d]                     | 2022/9/21          |

### 常用格式速查

| 格式需求                  | 参数配置                      | 示例结果            |
| --------------------- | ------------------------- | --------------- |
| yyyyMMdd              | $\[yyyyMMdd]              | 20230922        |
| yyyy-MM-dd            | $\[yyyy-MM-dd]            | 2023/9/22       |
| yyyy/MM/dd            | $\[yyyy/MM/dd]            | 2023/9/22       |
| yyyyMMddHHmmss        | $\[yyyyMMddHHmmss]        | 20230922180000  |
| yyyy-MM-dd HH\:mm\:ss | $\[yyyy-MM-dd HH\:mm\:ss] | 2023/9/22 18:00 |
| HH\:mm\:ss            | $\[HH\:mm\:ss]            | 18:00:00        |
| 毫秒时间戳                 | timestamp()               | 1695463200000   |
| 秒时间戳                  | unix\_timestamp()         | 1695463200      |

### 系统参数速查

| 参数名                  | 说明            | 格式                    | 调度运行 | 临时运行 |
| -------------------- | ------------- | --------------------- | ---- | ---- |
| bizdate              | 业务日期（计划时间-1天） | yyyyMMdd              | ✓    | ✓    |
| sys\_biz\_day        | 业务日期          | yyyy-MM-dd            | ✓    | ✓    |
| sys\_biz\_datetime   | 业务时间          | yyyy-MM-dd HH\:mm\:ss | ✓    | ✓    |
| sys\_plan\_day       | 计划日期          | yyyy-MM-dd            | ✓    | ✓    |
| sys\_plan\_datetime  | 计划时间          | yyyy-MM-dd HH\:mm\:ss | ✓    | ✓    |
| sys\_plan\_timestamp | 计划时间戳         | 13位毫秒                 | ✓    | ✓    |
| sys\_task\_id        | 任务ID          | 整数                    | ✓    | ✗    |
| sys\_task\_name      | 任务名称          | 字符串                   | ✓    | ✗    |
| sys\_task\_owner     | 任务负责人         | 字符串                   | ✓    | ✗    |

### 偏移量单位速查

| 单位 | 缩写  | 全称                | 示例    |
| -- | --- | ----------------- | ----- |
| 毫秒 | ms  | milli/millisecond | 400ms |
| 秒  | s   | sec/second        | 30s   |
| 分钟 | m   | min/minute        | 15m   |
| 小时 | h   | hour              | 2h    |
| 天  | d   | day               | -1d   |
| 周  | w   | week              | -1w   |
| 月  | mon | month             | -1mon |
| 年  | y   | year              | -1y   |

### 时间函数速查

| 函数                      | 功能              | 示例                                           |
| ----------------------- | --------------- | -------------------------------------------- |
| first\_day\_of\_month() | 当月第一天           | first\_day\_of\_month('yyyy-MM-dd', '-1mon') |
| last\_day\_of\_month()  | 当月最后一天          | last\_day\_of\_month()                       |
| first\_day\_of\_week()  | 当周第一天（周一）       | first\_day\_of\_week('yyyy-MM-dd')           |
| last\_day\_of\_week()   | 当周最后一天（周日）      | last\_day\_of\_week()                        |
| day\_of\_week()         | 返回周几（1-7）       | day\_of\_week('-1d')                         |
| week\_of\_month()       | 本月第几周           | week\_of\_month()                            |
| week\_of\_year()        | 本年第几周           | week\_of\_year()                             |
| get\_day\_of\_week()    | 获取指定周几的日期       | get\_day\_of\_week('yyyy-MM-dd', 2, '-1w')   |
| timestamp()             | 毫秒时间戳           | timestamp(-1d)                               |
| biz\_timestamp()        | 业务时间戳（00:00:00） | biz\_timestamp(-1d)                          |
| unix\_timestamp()       | 秒时间戳            | unix\_timestamp()                            |
| biz\_unix\_timestamp()  | 业务秒时间戳          | biz\_unix\_timestamp()                       |
| biz\_format()           | 业务时间格式化         | biz\_format('yyyy-MM-dd', -1d)               |

***

## 实际场景示例

### 场景1：处理昨天的分区数据

**需求**：每天凌晨处理前一天的订单数据

```SQL
-- SQL任务
INSERT OVERWRITE TABLE order_summary PARTITION(dt='${yesterday}')
SELECT 
    order_id,
    SUM(amount) as total_amount,
    COUNT(*) as order_count
FROM order_detail
WHERE dt = '${yesterday}'
GROUP BY order_id;
```

**参数配置**：

* `yesterday` = `$[yyyy-MM-dd, -1d]`

**说明**：假设任务在2023-09-22执行，参数替换为 `2023-09-21`

***

### 场景2：生成月报（上月数据统计）

**需求**：每月1号生成上月的销售报表

```SQL
-- SQL任务
SELECT 
    product_id,
    SUM(sales_amount) as total_sales,
    COUNT(DISTINCT user_id) as unique_users
FROM sales_table
WHERE dt BETWEEN '${last_month_start}' AND '${last_month_end}'
GROUP BY product_id;
```

**参数配置**：

* `last_month_start` = `first_day_of_month('yyyy-MM-dd', '-1mon')`
* `last_month_end` = `last_day_of_month('yyyy-MM-dd', '-1mon')`

**说明**：假设在2023-09-01执行

* `last_month_start` → `2023-08-01`
* `last_month_end` → `2023-08-31`

***

### 场景3：周报统计（上周一到周日）

**需求**：每周一生成上周的用户活跃报告

```SQL
-- SQL任务
SELECT 
    DATE(login_time) as login_date,
    COUNT(DISTINCT user_id) as active_users
FROM user_login_log
WHERE dt BETWEEN '${last_week_monday}' AND '${last_week_sunday}'
GROUP BY DATE(login_time)
ORDER BY login_date;
```

**参数配置**：

* `last_week_monday` = `first_day_of_week('yyyy-MM-dd', '-1w')`
* `last_week_sunday` = `last_day_of_week('yyyy-MM-dd', '-1w')`

**说明**：假设在2023-09-25（周一）执行

* `last_week_monday` → `2023-09-18`（上周一）
* `last_week_sunday` → `2023-09-24`（上周日）

***

### 场景4：获取每周二的数据

**需求**：定期分析每周二的促销活动效果

```SQL
-- SQL任务
SELECT 
    promotion_id,
    SUM(sales_amount) as tuesday_sales
FROM sales_table
WHERE dt = '${this_tuesday}'
GROUP BY promotion_id;
```

**参数配置**：

* `this_tuesday` = `get_day_of_week('yyyy-MM-dd', 2)`

**说明**：

* 假设任务在2023-09-22（周五）执行 → `2023-09-19`（本周二）
* 假设任务在2023-09-25（周一）执行 → `2023-09-26`（本周二）

***

### 场景5：时间戳范围查询（查询今天全天数据）

**需求**：实时查询今天00:00:00到当前时间的订单数据

```SQL
-- SQL任务
SELECT 
    order_id,
    order_time,
    amount
FROM orders
WHERE order_timestamp >

**错误用法**：
```SQL
-- ❌ 缺少引号导致SQL语法错误
WHERE city = ${city}        # 替换后：WHERE city = Shanghai（语法错误）

-- ❌ 多余的引号
WHERE id = '${user_id}'     # 替换后：WHERE id = '12345'（类型错误）
```

### Q4：临时运行和调度运行的参数有什么区别？

| 维度     | 临时运行         | 调度运行                  |
| ------ | ------------ | --------------------- |
| 参数来源   | 弹窗手动输入       | 参数配置中的取值              |
| 生效范围   | 仅本次运行        | 每次调度都生效               |
| 时间基准   | 点击运行的时刻      | 调度计划时间                |
| 任务信息参数 | 不支持（无实际任务实例） | 支持 sys\_task\_\* 系列参数 |
| 适用场景   | 调试、验证        | 生产环境自动运行              |

**注意**：临时运行时输入的参数值**不会保存**到参数配置中，参数配置中只保存参数赋值的逻辑（表达式或常量）。

***

### Q5：如何验证参数配置是否正确？

**使用简单查询验证**

```SQL
SELECT '${lastDay}' as lastDay;
```

参数配置：`lastDay = add_days('yyyy-MM-dd', -1)`

**查看执行日志** 执行后查看日志中的实际执行SQL，确认参数是否正确替换。

如果返回昨天的日期（如 `2023-09-21`），说明参数功能正常。

***

### Q6：Python任务中如何使用参数？

**示例**：
```Python
# 定义参数（使用字符串变量）
yesterday = '${yesterday}'
start_ts = ${start_ts}
task_name = '${task_name}'

# 使用参数
print(f"处理日期：{yesterday}")
print(f"开始时间戳：{start_ts}")

# 在SQL中使用
sql = f"""
    SELECT * FROM table 
    WHERE dt = '{yesterday}'
      AND create_time >= {start_ts}
"""
```

**参数配置**：

* `yesterday` = `$[yyyy-MM-dd, -1d]`
* `start_ts` = `biz_timestamp()`
* `task_name` = `sys_task_name`

**注意**：

* 字符串类型参数需要加引号：`'${yesterday}'`
* 数值类型参数不加引号：`${start_ts}`

***

### Q7：如何处理月末日期偏移问题？

**问题**：1月31日减1个月应该是12月31日，但有些月份没有31日

**解决方案**：使用 `last_day_of_month()` 函数

```SQL
-- 推荐写法（明确要上月最后一天）
SELECT '${last_month_end}' as last_month_end;
-- 参数配置：last_month_end = last_day_of_month('yyyy-MM-dd', '-1mon')
-- 始终返回上月最后一天
```

***

### Q8：如何调试复杂的参数表达式？

**技巧1：逐步验证**

```SQL
-- 先验证基础表达式
SELECT '${base_date}' as base_date;
-- base_date = $[yyyy-MM-dd]

-- 再添加偏移量
SELECT '${offset_date}' as offset_date;
-- offset_date = $[yyyy-MM-dd, -1mon]

-- 最后添加多个偏移量
SELECT '${final_date}' as final_date;
-- final_date = $[yyyy-MM-dd, -1mon, -7d]
```

**技巧2：使用注释说明**

```SQL
SELECT 
    '${report_start}' as report_start,  -- 上月第一天
    '${report_end}' as report_end,      -- 上月最后一天
    '${last_year_date}' as last_year_date  -- 去年同期
FROM table;
```

在参数配置中也添加说明，方便后续维护。

***

### Q9：参数加密后如何修改？

**步骤**：

1. 点击参数配置，找到加密的参数
2. 取消勾选"加密取值"
3. 参数值会明文显示，可以修改
4. 修改完成后重新勾选"加密取值"

**注意**：加密仅用于显示，不影响参数的实际使用。

^

***

## 附：如何确认是否支持完整参数功能

使用以下验证SQL：

```SQL
SELECT '${lastDay}' as lastDay;
```

**参数配置**：

* `lastDay` 赋值填写 `add_days('yyyy-MM-dd', -1)`

**校验逻辑**：
```
检查参数替换、任务执行返回结果是否正常。
如果返回正常，则说明在灰度范围内、支持完整的参数功能，否则说明不支持。
假定当前日期是2023-11-12，正常的返回值会是2023-11-11。
```

^
