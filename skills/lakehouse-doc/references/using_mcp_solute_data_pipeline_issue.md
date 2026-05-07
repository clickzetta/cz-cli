# 使用 ClickZetta MCP + Claude 进行数据运维问题排查

## 问题背景

某天下午，突然收到短信告警：**周期调度的数据更新任务失败**。

作为值班 DBA，立即登录 ClickZetta Lakehouse，初步排查后发现：

* 物化视图 `daily_summary_mv` 从当天 10 点后没有新数据；
* 手动 刷新该物化视图可以刷新成功，但数据并没有更新；
* 上游源表确认有最新数据。

问题很棘手：源表有数据，MV 却刷不出来，而这个 MV 的 SQL 定义超过 200 行，涉及多个 CTE 和复杂的 JOIN 逻辑。

**传统做法**：逐行阅读 MV 定义 → 手写诊断 SQL → 逐层排查 → 可能花费数小时。

**MCP + Claude 做法**：描述问题，使用 ClickZetta MCP + Claude 帮助分析，数分钟后即得到了准确的问题根因，并进一步获得了修复建议。

***

## 第一步：切换环境（30秒）

### 👤 提示词

使用提示词，切换到发生问题的环境：

```
使用 ClickZetta MCP 工具，切换到腾讯云上海环境
```

### 🤖 Claude 响应

```
✅ 已成功切换到腾讯云上海环境！

当前连接信息：
| 配置项 | 值 |
|--------|-----|
| 服务端点 | ap-shanghai-tencentcloud.api.clickzetta.com |
| 实例ID | 158026 |
| Workspace | data_warehouse |
| Schema | public |
```

> 💡 **技巧**：ClickZetta MCP 支持配置多个云环境，在配置好连接环境后，用自然语言即可快速切换，无需记忆连接参数。

***

## 第二步：描述问题，让 AI 自动诊断（3分钟）

### 👤 提示词

```
帮我分析以下问题的原因：

我收到系统监控报警，report_schema.daily_summary_mv 从 12 月 13 日下午开始没有数据。

我执行 SELECT bill_hour, COUNT(1) FROM report_schema.daily_summary_mv 
WHERE bill_date = '20251213' GROUP BY bill_hour; 
发现从 10 点以后就没有数据了。

但是源表 raw_schema.event_details 是有数据的。

执行 REFRESH MATERIALIZED VIEW 刷新后，仍没有 10 点以后的数据。

查询并分析造成这一问题的原因。
```

> 💡 **提问技巧**：描述问题时包含以下要素效果最佳，描述得越具体、准确，越能提高排查效率且避免模型产生幻觉：
>
> * 📌 **现象**：什么数据没有了
> * 📌 **时间点**：从什么时候开始
> * 📌 **已尝试的操作**：做过什么排查
> * 📌 **矛盾点**：源表有数据但 MV 没有

### 🤖 Claude 自动诊断过程

Claude 收到问题后，自动规划并执行了以下诊断步骤：

***

#### 诊断步骤 1：获取 MV 定义，理解数据逻辑

```sql
-- Claude 自动执行
DESC TABLE EXTENDED report_schema.daily_summary_mv
```

Claude 从返回的 `view_text` 中识别出关键逻辑：

```
📍 发现关键线索！

物化视图中有一个 MaxDateHour 的边界控制逻辑，它取两个数据源的最小值作为边界：

WITH MaxDateHour AS (
    SELECT MIN(max_ts) AS max_ts    -- ⚠️ 取最小值！
    FROM (
        -- 第一路数据
        SELECT MAX(CONCAT(ds, '-', hh)) AS max_ts
        FROM event_details WHERE event_type = 'type_a'
        UNION ALL
        -- 第二路数据  
        SELECT MAX(CONCAT(ds, '-', hh)) AS max_ts
        FROM metrics_data
    ) t1
)
```

***

#### 诊断步骤 2：检查边界值

```sql
-- Claude 自动执行
SELECT MIN(max_ts) AS current_boundary
FROM (
    SELECT MAX(CONCAT(ds, '-', hh)) AS max_ts
    FROM raw_schema.event_details WHERE event_type = 'type_a'
    UNION ALL
    SELECT MAX(CONCAT(ds, '-', hh)) AS max_ts
    FROM raw_schema.metrics_data
) t1
```

**结果**：

```
| current_boundary |
|------------------|
| 20251213-10      |
```

```
✅ 找到问题了！MaxDateHour 边界是 20251213-10，正好对应数据截止时间。
```

***

#### 诊断步骤 3：定位是哪个数据源落后

```sql
-- Claude 自动执行：分别检查两个数据源
SELECT 'source_a (type_a only)' AS source, MAX(CONCAT(ds, '-', hh)) AS max_ts
FROM raw_schema.event_details WHERE event_type = 'type_a'
UNION ALL
SELECT 'source_a (all types)' AS source, MAX(CONCAT(ds, '-', hh)) AS max_ts
FROM raw_schema.event_details WHERE event_type IN ('type_a', 'type_b', 'type_c')
UNION ALL
SELECT 'source_b' AS source, MAX(CONCAT(ds, '-', hh)) AS max_ts
FROM raw_schema.metrics_data
ORDER BY source
```

**结果**：

```
| source                  | max_ts       |
|-------------------------|--------------|
| source_a (type_a only)  | 20251213-10  |  ⬅️ 瓶颈在这里！
| source_a (all types)    | 20251213-18  |
| source_b                | 20251213-16  |
```

***

#### 诊断步骤 4：确认数据特征

```sql
-- Claude 自动执行：查看各类型的数据分布
SELECT event_type, MAX(hh) as max_hour, COUNT(1) as record_count
FROM raw_schema.event_details 
WHERE ds = '20251213' AND event_type IN ('type_a', 'type_b', 'type_c')
GROUP BY event_type
ORDER BY event_type
```

**结果**：

```
| event_type | max_hour | record_count |
|------------|----------|--------------|
| type_a     | 10       | 300          |  ⬅️ 事件驱动，数据稀疏
| type_b     | 18       | 7,070        |
| type_c     | 18       | 22,215       |
```

***

### 🤖 Claude 输出：根因分析报告

Claude通过实际在Lakehouse中执行查询和对返回数据的分析，很快得到了问题根因：

MV 定义中使用 MIN() 取多个数据源的最小边界值。
type\_a 是事件驱动型数据，只有用户执行特定操作时才产生记录。
12月13日10点后没有相关操作，导致该类型数据"停滞"，卡住了整个 MV。

以下是Claude的完整回复：

```
🔍 问题根因分析报告

问题定位
物化视图的数据被 MaxDateHour 边界条件限制在了 2025年12月13日10点。

数据验证
| 数据源 | 最新数据时间 | 说明 |
|--------|-------------|------|
| event_details (type_a) | 20251213-10 | ⚠️ 瓶颈源 |
| event_details (全部类型) | 20251213-18 | 正常 |
| metrics_data | 20251213-16 | 正常 |

根本原因
MV 定义中使用 MIN() 取多个数据源的最小边界值。
type_a 是事件驱动型数据，只有用户执行特定操作时才产生记录。
12月13日10点后没有相关操作，导致该类型数据"停滞"，卡住了整个 MV。

影响链路
type_a 数据停在 10 点
    ↓
MaxDateHour = MIN(10, 16) = 10
    ↓
WHERE 条件过滤掉 > 10 点的所有数据
    ↓
type_b、type_c 的新数据也被排除
    ↓
物化视图无新数据

建议方案
修改 MaxDateHour 计算逻辑，将边界条件从仅 type_a 改为包含所有相关类型...
```

***

## 第三步：根据业务需求，迭代优化方案（2分钟）

Claude 给出的初步方案是直接修改边界逻辑。根据经验，对已有 MV DDL 中边界条件的修改很可能在重建后影响过去的历史数据。这在要求历史数据不许变更的业务中是不可接受的。

因此，在提示词中追加了以下约束，要求在满足要求的前提下提供更好的解决方案：

### 👤 提示词

```
采用这种方案：修改 MaxDateHour 的计算逻辑，将边界条件从仅 type_a 改为包含所有类型。

但由于这是一个 MV，改变 DDL 重新刷新后会改变所有过去的数据，造成历史数据和已处理记录不一致。

所以这里的修改希望能够兼容历史数据，加上从 2025年12月13日20点之后，
才使用新的边界计算方式。应该怎么处理？
```

> 💡 **迭代技巧**：AI 给出的初步方案可能不完全符合业务需求。业务需求的背景知识并不存在于 AI 这次对话的上下文中，所以必须由人来充分考虑，并将这种业务约束补充给 AI。在使用 AI 来协助运维和解决问题时，不能放弃思考，无脑遵循 AI 给出的建议来执行。尤其需要提供的是“为什么有这个约束”，这样更能发挥 AI 的思考、推理能力。
>
> 通过追加约束条件，让 AI 生成更精准的方案：
>
> * 📌 **明确约束**：不能影响历史数据
> * 📌 **给出边界**：从什么时间点开始生效
> * 📌 **说明原因**：为什么有这个约束

### 🤖 Claude 输出：兼容性改造方案

Claude 理解了业务约束后，设计了一个向后兼容的方案：

```
设计思路

需要修改 MaxDateHour 的逻辑，使其：
- 2025年12月13日20点之前：继续使用原来的 type_a 边界（保护历史数据）
- 2025年12月13日20点及之后：使用新的全类型边界

兼容性改造 SQL

WITH MaxDateHour AS (
    SELECT 
        SPLIT(t2.max_ts, '-')[0] AS max_ds,
        SPLIT(t2.max_ts, '-')[1] AS max_hh,
        t2.max_ts
    FROM (
        SELECT MIN(max_ts) AS max_ts
        FROM (
            -- 数据源 A（兼容历史逻辑）
            SELECT GREATEST(
                -- 原逻辑：只用 type_a（保护历史数据）
                (SELECT COALESCE(MAX(CONCAT(ds, '-', hh)), '19700101-00') 
                 FROM raw_schema.event_details 
                 WHERE event_type = 'type_a'),
                 
                -- 新逻辑：全类型边界，仅在 >= 切换时间点后生效
                (SELECT CASE 
                    WHEN MAX(CONCAT(ds, '-', hh)) >= '20251213-20' 
                    THEN MAX(CONCAT(ds, '-', hh)) 
                    ELSE '19700101-00' 
                 END
                 FROM raw_schema.event_details 
                 WHERE event_type IN ('type_a', 'type_b', 'type_c'))
            ) AS max_ts
            
            UNION ALL
            
            -- 数据源 B（保持不变）
            SELECT MAX(CONCAT(ds, '-', hh)) AS max_ts
            FROM raw_schema.metrics_data
        ) t1
    ) t2
)

逻辑说明

| 场景 | type_a 边界 | 全类型边界 | GREATEST 结果 | 效果 |
|------|-------------|------------|---------------|------|
| 历史数据 (< 切换点) | 20251213-10 | 返回最小值 | 20251213-10 | ✅ 保持原逻辑 |
| 新数据 (≥ 切换点) | 20251213-10 | 20251213-18 | 20251213-18 | ✅ 使用新逻辑 |
```

***

## 第四步：根据Claude建议的方案，对线上逻辑进行修复（2分钟）

在这个案例中，直接按照上述逻辑在线上环境中手动更新了MV的DDL，重建MV后，成功修复了线上问题。

其实也可以直接要求 Claude 根据上述方案操作修改该 MV 进行修复，现有工具能力完全可以实现。但考虑到线上环境较为复杂，为了避免大模型幻觉造成操作失误并引发其他问题，个人对于线上数据和表的修改、写入、重建等操作，还是倾向于采用更稳妥的人工执行方式。

还有一种方式是让 Claude 根据上述方案创建一个临时视图，然后自动比对两个视图的数据，验证无误后，再更新原 MV 的 DDL。这样会更加稳妥。这个案例中的问题比较直白，为了快速修复，就省去了这一步骤。

## 完整对话流程回顾

:-: ![](/.topwrite/assets/sre_problem.png =622)

***

## 传统方式与使用MCP方式对比

| 传统方式             | MCP + Claude   |
| -------------------- | -------------- |
| 手动阅读 200 行 MV 定义 | AI 自动解析，识别关键逻辑 |
| 凭经验猜测问题点       | 系统化诊断，逐层验证     |
| 手写多条诊断 SQL       | AI 自动生成并执行     |
| 结果需要人工分析       | AI 直接给出根因结论    |
| 方案需要反复调整       | 对话式迭代，快速收敛     |

***

*本文基于真实运维场景，表名和业务细节已做脱敏处理。*
