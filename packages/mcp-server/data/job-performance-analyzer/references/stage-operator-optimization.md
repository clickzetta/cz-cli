# Stage/Operator 级别优化指南

本文档包含增量计算 REFRESH SQL 的 Stage/Operator 级别优化规则。

这是增量优化的第一部分，主要从运行的 stage/operator 算子级别进行优化。

**相关文档**：
- [增量算法分析](./incremental-algorithm-analysis.md) - 增量算法识别和分析
- [状态表优化](./state-table-optimization.md) - 状态表相关优化规则
- [优化原则](./optimization-principles.md) - 参数推荐原则

---

## Stage/Operator 级别优化

### 4.1.1 增量 refresh vs 全量 refresh

**目的**：判断 REFRESH 是增量还是全量

**判断方法**：
1. 从 `plan.json` 找到 REFRESH 的目标表
2. 定位对应的 TableSink 算子，获取 `table.path`
3. 判断规则（基于 `path` 和 `overwrite`）：
   - **如果** `path` 是 4 元组且最后一个元素是 `__delta__` → **增量 REFRESH**（写入 delta 文件）
   - **如果** `path` 是 3 元组且 `overwrite=false` → **增量 REFRESH**
   - **其他情况**（3 元组且 `overwrite=true`）→ **全量 REFRESH**

**path 格式说明**：
- **3元组**：`[workspace, namespace, table_name]` - 例如 `['gic_prod', 'kscdm', 'dim_ks_live_daily']`
- **4元组**：`[workspace, namespace, table_name, '__delta__']` - 例如 `['gic_prod', 'kscdm', 'dim_ks_live_daily', '__delta__']`

**注意**：忽略中间表（table_name 包含 `__incr__`、`__state__`、`__temp__` 等 pattern），这些是中间状态表。

**代码示例**：
```python
# 从 TableSink 中获取 path 和 overwrite 标志
table_sink = stage['operators'][i]['tableSink']
path = table_sink['table']['path']  # 列表格式
overwrite = table_sink.get('overwrite', True)

# 判断逻辑
if len(path) == 4 and path[-1] == '__delta__':
    refresh_type = "增量"  # 写入 delta 文件
elif len(path) == 3 and not overwrite:
    refresh_type = "增量"  # overwrite=false
else:
    refresh_type = "全量"  # 3元组且 overwrite=true

# 提取表名（在 path[2]）
table_name = path[2]
```

---

### 4.1.2 单 DOP Aggregate Stage 优化

**触发条件**（必须**全部**满足）：
1. Stage 的 `dop = 1`
2. Stage 耗时满足以下**任一**条件：
   - **(耗时 > 20秒 且 占总耗时 > 10%)** 或者
   - **耗时 > 30秒**
3. Stage 输入数据（一般是 shuffle read 算子）**> 20MB**
4. Stage 包含 **HashAggregate** 算子
5. 聚合函数包含昂贵函数：`MULTI_RANGE_COLLECT`, `_DF_BF_COLLECT`, `BF_COLLECT`, `DF_BF_COLLECT`
6. **聚合状态是 Final 或 Complete**（表示最后一个聚合阶段）
7. **上游 stage 没有 P2 状态**（说明当前只有 2 阶段聚合，没有开启 3 阶段）

**判断逻辑**：
- 如果当前 stage 的 aggregate 是 **Final** 或 **Complete** 状态
- 且上游 stage **没有 P2/PARTIAL2** 状态
- 说明当前只有 **2 阶段聚合**（P1 → Final），需要优化为 **3 阶段**（P1 → P2 → Final）

**优化建议**：

1. **开启三阶段聚合**（如果未开启）：
   ```sql
   set cz.optimizer.incremental.df.three.phase.agg.enable = true;
   ```
   注意：如果已有 `cz.optimizer.df.enable.three.phase.agg=true`，则不需要重复设置

2. **禁用 one-pass 聚合**（如果聚合退化为 Complete）：
   ```sql
   set cz.optimizer.enable.one.pass.agg = false;
   ```

3. **调整 BF bits 阈值**（如果 bits 在 512M-1G 范围内）：
   ```sql
   set cz.optimizer.df.three.phase.agg.bf.width.threshold = <bits值>;
   ```
   - 如果 `bits >= 536870912` 且 `bits < 1073741824`，需要设置此参数
   - 默认阈值是 1073741824（1.3版本及以下），1.3以上版本默认值是 536870912
   - 小于默认阈值不会生成 3 阶段
   - 如果 `bits < 536870912`，不建议修改此参数

**代码示例**：
```python
# 检查输入数据量（从 metrics 中获取）
metrics = stage_data.get('metrics', {})
input_bytes = metrics.get('input_bytes', 0)
input_mb = input_bytes / (1024 * 1024)

if input_mb < 20:
    # 输入数据量太小，不需要优化
    pass

# 检查当前 stage 的聚合状态
has_final = 'FINAL' in aggregate_mode
has_complete = 'Complete' in aggregate_mode

# 检查上游 stage 是否有 P2
upstream_has_p2 = False
for upstream_stage in upstream_stages:
    if 'P2' in upstream_aggregate_mode or 'PARTIAL2' in upstream_aggregate_mode:
        upstream_has_p2 = True
        break

# 判断是否需要优化
if (has_final or has_complete) and not upstream_has_p2:
    # 当前只有 2 阶段，需要开启 3 阶段优化
    recommend_three_phase_agg = True
```

---

### 4.1.2.1 Bloom Filter 收集检测（高优先级）

**目的**：检测增量计算中是否缺少 Bloom Filter 收集，这会导致数据裁剪效果不佳

**触发条件**：
1. Stage 包含 **HashAggregate** 算子
2. 聚合函数包含 `MULTI_RANGE_COLLECT`
3. **但缺少** `_DF_BF_COLLECT` 或 `_DF_SET_BF_COLLECT` 函数

**判断逻辑**：
```python
# 获取所有聚合函数
agg_functions = []
for op in operators:
    if 'hashAgg' in op:
        agg_calls = op['hashAgg']['aggregate']['aggregateCalls']
        for call in agg_calls:
            func_name = call['function']['function']['name']
            agg_functions.append(func_name)

# 检查是否有 MULTI_RANGE_COLLECT
has_multi_range = any('MULTI_RANGE_COLLECT' in func for func in agg_functions)

# 检查是否缺少 BF 收集
has_bf_collect = any(
    '_DF_BF_COLLECT' in func or '_DF_SET_BF_COLLECT' in func 
    for func in agg_functions
)

# 如果有 MULTI_RANGE_COLLECT 但没有 BF 收集，则需要优化
needs_optimization = has_multi_range and not has_bf_collect
```

**优化建议**：

**对于 v1.3 版本**，添加以下完整配置：
```sql
set cz.optimizer.incremental.df.three.phase.agg.enable = true;
set cz.optimizer.df.three.phase.agg.bf.width.threshold = 536870912;
set cz.optimizer.df.bf.width.max = 2147483648;
set cz.optimizer.df.bf.width.min = 1073741824;
set cz.optimizer.incremental.enforce.creating.bf = true;
```

**对于其他版本**，至少添加：
```sql
set cz.optimizer.incremental.enforce.creating.bf = true;
```

**注意**：
- 如果参数已经存在且值正确，则不要重复推荐
- 这是**高优先级**优化，因为缺少 BF 会严重影响增量计算的裁剪效果
- Bloom Filter 用于在增量计算中快速过滤不需要的数据，提升性能

**代码示例**：
```python
# 检查版本
version_info = context.get('version_info', {})
git_branch = version_info.get('git_branch', '')
is_v13 = 'release-v1.3' in git_branch

# 生成推荐
if is_v13:
    # v1.3 版本需要完整配置
    params = [
        ('cz.optimizer.incremental.df.three.phase.agg.enable', 'true'),
        ('cz.optimizer.df.three.phase.agg.bf.width.threshold', '536870912'),
        ('cz.optimizer.df.bf.width.max', '2147483648'),
        ('cz.optimizer.df.bf.width.min', '1073741824'),
        ('cz.optimizer.incremental.enforce.creating.bf', 'true')
    ]
else:
    # 其他版本只需要强制创建 BF
    params = [
        ('cz.optimizer.incremental.enforce.creating.bf', 'true')
    ]

# 检查并推荐未设置的参数
for param, value in params:
    if settings.get(param) != value:
        recommend(param, value, priority='HIGH')
```

---

### 4.1.3 Hash Join 优化

**触发条件**：
1. Stage 耗时 **> 10秒** 或 占总耗时 **> 8%**
2. Stage 包含 Join operator
3. Join 耗时 **> 30%** 的 Stage 时间

**分析方法**：
- Join 算法：从 `plan.json` 获取
- 数据量/Shuffle 量：从 `job_profile.json` 获取

**优化建议**：

**IF** Join 算法 = `Broadcast Hash Join`  
**AND** Broadcast/Shuffle 数据量异常大：

搜索 settings 中 `cz.optimizer.enable.broadcast.hash.join`：

**IF** 参数不存在 **OR** 值 = `true`：
```sql
-- 推荐
set cz.optimizer.enable.broadcast.hash.join = false;
```

**代码示例**：
```python
plan_str = json.dumps(stage['operators'])
is_broadcast = 'BroadcastHashJoin' in plan_str or 'Broadcast' in plan_str
```

---

### 4.1.4 包含 TableSink 的 Stage DOP 优化

**触发条件**（必须**全部**满足）：
1. Stage 包含 **TableSink** 算子（排除 partial sink 和 DELTA sink）
   - **Partial sink**: `flags & 0x20 != 0`
   - **DELTA sink**: `path` 最后一个元素是 `__delta__`（4元组）
2. Stage 耗时占总体 **> 10%**
3. Stage DOP **与上游 DOP 差异较大**

**不应推荐的情况**：
- Stage **不包含** TableSink 算子
- Stage DOP 与上游 DOP 接近（≥ 上游max * 0.5）
- Stage DOP **已大于**上游 DOP（下游 DOP 都已经大于上游，无需调整）

**原因推断**：
系统可能根据**目标表文件大小**自动调整了 DOP。

**优化建议**：

计算上游最大 DOP：
```python
upstream_dops = [metrics['dop'] for sid, metrics in stages if sid != current_stage]
max_upstream = max(upstream_dops)
```

**检查 TableSink 是否为 partial sink 或 DELTA sink**：
```python
# 从 plan.json 中的 TableSink 算子获取信息
table_sink = operator.get('tableSink', {})
flags = table_sink.get('flags', 0)
table = table_sink.get('table', {})
path = table.get('path', [])

# 判断是否为 partial sink
is_partial_sink = (flags & 0x20) != 0

# 判断是否为 DELTA sink (path 最后一个元素是 __delta__)
is_delta_sink = len(path) == 4 and path[-1] == '__delta__'

# 只对非 partial sink 且非 DELTA sink 的 TableSink 进行 DOP 优化检查
if is_partial_sink or is_delta_sink:
    # 跳过
    pass
```

**IF** `current_dop < max_upstream * 0.5` **AND** `current_dop <= max_upstream`：

搜索 settings 中 `cz.sql.enable.dag.auto.adaptive.split.size`：

**IF** 参数值 = `true`（已经设置该 flag 为 true 才需要）：
```sql
-- 推荐
set cz.sql.enable.dag.auto.adaptive.split.size = false;
```

**注意**：
- 该参数目的是不根据 table 的目标文件大小来自动调整 DOP
- 如果在这种场景下，stage 里没有 tablesink 算子不要加该参数
- 如果上游 DOP 和自己相差不大（即计算依赖 stage 的 task count），则不需要额外设置
- 如果 stage 的 DOP 大于上游 stage 的 DOP，则也不需要调整该参数

⚠️ **警告**：此参数影响全局，请谨慎使用。

---

### 4.1.5 最大 DOP 提示

**DAG 限制**：
- Map 最大 DOP = `4096`
- Reduce 最大 DOP = `2048`

**原则**：
- 达到这些限制通常**不是问题**
- **除非**用户显式调整过这些参数：
  - `cz.optimizer.mapper.stage.max.dop`
  - `cz.optimizer.reducer.stage.max.dop`

**处理方式**：
```python
if stage_dop >= 4096 or stage_dop >= 2048:
    # 检查是否用户主动设置了 max dop 参数
    if 'cz.optimizer.mapper.stage.max.dop' in settings or \
       'cz.optimizer.reducer.stage.max.dop' in settings:
        # 可能需要分析
        pass
    else:
        # 达到系统限制，这是正常的
        print(f"Stage {stage_id} DOP达到系统限制，这是正常的")
```

---

### 4.1.6 数据倾斜检测

**目的**：检测数据倾斜问题并提供优化建议

**触发条件**：
- 少于 **5%** 的 task 有数据（即 active task 比例 < 5%）

**判断方法**：
1. 从 `job_profile.json` 的 `taskSummary` 获取每个 task 的情况
2. 统计有数据的 task 数量（`inputBytes > 0` 或 `outputBytes > 0`）
3. 计算 active task 比例 = active_tasks / total_tasks

**优化建议**：

**场景 1：Stage 包含 Scan 算子**

调整 split size 以缓解倾斜：
```sql
set cz.mapper.file.split.size = 67108864;  -- 从默认 256M (268435456) 调整为 64M
```

**场景 2：Stage 包含 Shuffle Read**

提示关注上游是否存在倾斜数据，需要检查：
- 上游 Stage 的数据分布
- Shuffle 分区策略
- 是否需要调整分区键

**代码示例**：
```python
# 检查倾斜
task_summary = profile.get('taskSummary', {})
total_tasks = len(task_summary)
active_tasks = 0

for task_id, task_data in task_summary.items():
    input_bytes = task_data.get('inputBytes', 0)
    output_bytes = task_data.get('outputBytes', 0)
    if input_bytes > 0 or output_bytes > 0:
        active_tasks += 1

active_ratio = active_tasks / total_tasks
is_skewed = active_ratio < 0.05  # 少于 5% 的 task 有数据

if is_skewed:
    # 检查是否有 scan 算子
    has_scan = any('Scan' in op.get('type', '') for op in operators)

    if has_scan:
        # 建议调整 split size
        current_split_size = settings.get('cz.mapper.file.split.size', 268435456)
        if current_split_size >= 268435456:
            recommend_split_size = 67108864  # 64M

    # 检查是否有 shuffle read
    has_shuffle_read = any('ShuffleRead' in op.get('type', '') for op in operators)

    if has_shuffle_read:
        # 提示关注上游倾斜
        print("检测到 Shuffle Read，请关注上游是否存在倾斜数据")
```

---

### 4.1.7 SpillingBytes 分析

**分析级别**：
1. **Stage 级别** - 总 Spill 大小
2. **Operator 级别** - 可以看到 `opId` 的 spill stats

**数据提取**：
```python
# Stage 级别
spill_bytes = stage_data['inputOutputStats']['spillingBytes']

# Operator 级别
for op_id, op_data in stage_data['operatorSummary'].items():
    if 'spillStats' in op_data:
        op_spill = op_data['spillStats']
        # 分析具体算子的 spilling
```

**注意**：
- **Shuffle Write 的 Spill 可能可以忽略**
- 重点关注其他算子的 Spilling

**分析输出**：
```python
if spill_bytes > 1024**3:  # > 1GB
    print(f"Stage {stage_id} Spilling: {spill_bytes/(1024**3):.2f} GB")
    # 分析哪个 operator 导致
    for op_id, op_data in operators:
        if has_spill(op_data):
            print(f"  Operator {op_id}: {op_spill} bytes")
```

---

### 4.1.8 资源效率分析

**目的**：对比每个 Stage 的实际运行时间与理论资源充足情况下的预期时间，检测资源不足导致的性能问题

**触发条件**：
1. 有 profile 数据且 taskSummary 存在
2. VC core 数有效（> 0）
3. Stage 耗时 > 5秒

**并发 Stage 资源竞争处理**：
多个 stage 可能并发执行，共享 vc_cores 资源。分析时需要：
1. 通过 `startTime`/`endTime` 找出与当前 stage 时间重叠的其他 stage
2. 累加并发 stage 的 dop 作为被占用的资源
3. 可用资源 = `max(1, vc_cores - 并发 stage 总 dop)`
4. 用调整后的可用资源计算预期耗时

**分析方法**：
1. 从 `taskSummary` 获取每个 task 的运行时间（`endTime - startTime`）
2. 找出最大 task 时间（`max_task_time`）
3. 计算总 task 数
4. 计算可用资源（扣除并发 stage 占用）
5. 计算需要跑多少轮：`rounds = ceil(total_tasks / available_cores)`
6. 预期耗时 = `max_task_time × rounds`
7. 对比实际耗时与预期耗时，如果实际 > 2倍预期，则告警

**VC Core 数获取**（参考 2.3）：
```python
# AP 模式
vc_cores = int(settings['cz.analyze.instance.executor.count'])
# GP 模式
vc_cores = int(settings['cz.sql.gp.vc.capability']) // 100
```

**代码示例**：
```python
# 计算并发 stage 占用的资源
concurrent_dop = 0
for other_stage in all_stages:
    if other_stage.id == current_stage.id:
        continue
    if other_stage.startTime < current_stage.endTime and other_stage.endTime > current_stage.startTime:
        concurrent_dop += other_stage.dop

available_cores = max(1, vc_cores - concurrent_dop)

# 从 taskSummary 获取每个 task 的运行时间
task_times = []
for task_id, task_data in task_summary.items():
    start_time = int(task_data.get('startTime', 0))
    end_time = int(task_data.get('endTime', 0))
    if end_time > start_time:
        task_times.append(end_time - start_time)

max_task_time = max(task_times)
total_tasks = len(task_times)

# 计算理论最优耗时（使用扣除并发后的可用资源）
rounds = (total_tasks + available_cores - 1) // available_cores
estimated_time = max_task_time * rounds

# 对比
efficiency_ratio = actual_elapsed / estimated_time
if efficiency_ratio >= 2.0:
    # 资源效率偏低，可能存在资源排队或调度开销
    report_issue(stage_id, actual_elapsed, estimated_time, efficiency_ratio)
```

---

### 4.1.9 主动问题发现（**必须执行**）

**要求**：
- **不允许**"没有发现问题"的结论
- 必须遍历**所有 Stage**
- 对耗时较长的 Stage 主动分析原因

**分析步骤**：

1. **找出 Top 耗时 Stage**（至少 Top 5）

2. **对每个 Stage 分析**：
   ```python
   # a. 找瓶颈 Operator
   bottleneck_op = max(operators, key=lambda op: op['max_time_ms'])
   
   # b. 判断原因
   if bottleneck_op['skew_ratio'] > 5.0:
       reason = "数据倾斜严重"
       suggestion = "SQL 改写或数据预处理"
   
   elif bottleneck_op['stage_pct'] > 80:
       reason = "单个 Operator 占主导"
       suggestion = "检查算子逻辑或数据分布"
   
   elif stage_dop <= 10:
       reason = "DOP 较低"
       suggestion = "检查是否需要提高并行度"
   
   elif stage_spill > 1GB:
       reason = f"Spilling 较大: {spill_gb:.2f} GB"
       suggestion = "检查内存配置或数据倾斜"
   ```

3. **输出分析结果**：
   ```
   [分析] Stage stg11: 212.7s (77.6%)
     瓶颈 Operator: Calc97
       耗时: 207.9s (97.7% of Stage)
       倾斜: 57.6x
     → 原因: 数据倾斜严重
     → 建议: SQL 改写或数据预处理
   ```

---

