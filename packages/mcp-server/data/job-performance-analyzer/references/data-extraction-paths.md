# JSON 数据提取路径快速参考

本文档提供常用的 JSON 路径和计算模式。

## plan.json 关键路径

### 基本信息
```python
# SQL 文本
sql_text = plan['settings']['cz.sql.text']

# 版本信息
version = plan['build_info']['GitBranch']

# VC 模式
is_ap = plan['settings']['cz.inner.is.ap.vc'] == '1'

# 所有已配置参数
settings = plan['settings']
```

### Stage 信息
```python
# 所有 Stage
stages = plan['dml']['stages']

for stage in stages:
    stage_id = stage.get('id', stage.get('stageId'))
    operators = stage.get('operators', [])
```

### Operator 详细信息
```python
# 遍历 Operator
for op in stage['operators']:
    # TableSink
    if 'tableSink' in op:
        sink = op['tableSink']
        mode = sink.get('mode')  # OVERWRITE, APPEND
        sink_type = sink.get('type')  # PhysicalTableSink_DELTA
    
    # TableScan
    if 'tableScan' in op:
        scan = op['tableScan']
        # 检查实际输出的列（operator的schema），而不是表定义的完整schema
        operator_schema = op.get('schema', {})
        struct_info = operator_schema.get('structTypeInfo', {})
        fields = [f['name'] for f in struct_info.get('fields', [])]
        # 检查 __incremental_deleted 列（注意是过去式）
        is_append_only = '__incremental_deleted' not in fields
    
    # HashAggregate
    if 'hashAgg' in op:
        agg = op['hashAgg']['aggregate']
        stage = agg.get('stage')  # P1, P2, FINAL, COMPLETE
        agg_calls = agg.get('aggregateCalls', [])
        
        for call in agg_calls:
            func = call['function']['function']
            func_name = func['name']  # SUM, COUNT, MIN, MAX, _DF_BF_COLLECT
            
            # BF bits
            if '_DF_BF_COLLECT' in func_name:
                props = func.get('properties', {}).get('properties', [])
                for prop in props:
                    if prop['key'] == 'bits':
                        bits = int(prop['value'])
    
    # Join
    if 'hashJoin' in op:
        join = op['hashJoin']
        if 'join' in join and 'type' in join['join']:
            join_type = join['join']['type']  # INNER, LEFT_SEMI, ANTI, etc.
    elif 'nestedLoopJoin' in op:
        join = op['nestedLoopJoin']
        if 'join' in join and 'type' in join['join']:
            join_type = join['join']['type']
    elif 'broadcastHashJoin' in op:
        join = op['broadcastHashJoin']
        if 'join' in join and 'type' in join['join']:
            join_type = join['join']['type']
    
    # Calc
    if 'calc' in op:
        calc = op['calc']
        expressions = calc.get('expressions', [])
        # 检查 UDF 或复杂函数
```

## job_profile.json 关键路径

### Job Profiling 阶段分析

#### Profiling ID 定义（官方）
```python
# 完整的 Job 生命周期阶段 ID
PROFILING_IDS = {
    90: 'COORDINATOR_CLIENT_SUBMIT',      # 客户端提交
    100: 'RECEIVE_SUBMIT',                # 接收提交（作业提交时间）
    101: 'PRECHECK_START',                # 开始precheck
    102: 'PRECHECK_END',                  # precheck结束
    103: 'JOB_META_CREATED',              # Job meta创建成功
    104: 'COORDINATOR_QUEUE',             # job在coordinator排队（如果没有排队则没有这个阶段）
    105: 'COORDINATOR_PRE_RUN',           # job在coordinator拿到槽位开始preRun
    106: 'COORDINATOR_RUN',               # job在coordinator开始执行runInternal
    108: 'PLAN_CREATED',                  # 作业编译优化做完（如果命中result cache则没有这个阶段）
    110: 'SUBMIT_TO_RM',                  # 作业尝试提交到rm
    111: 'VC_RUNNING',                    # vc拉起（如果vc挂起则这个阶段会花一些时间）
    112: 'RM_APP_CREATED',                # 作业提交到RM，开始等资源
    120: 'GOT_FIRST_RESOURCE_START_RUN',  # 作业拿到资源开始运行
    130: 'DAG_COMPLETE',                  # DAG结束
    131: 'DATA_COMMIT_START',             # 开始commit数据（如果有）
    132: 'AUTO_MERGE_SUBMIT',             # 开始跑auto merge（如果有）
    135: 'QUICK_ADHOC_FINISH',            # Quick adhoc返回结果
    140: 'QUERY_SUCCEED',                 # coordinator内的job_base执行结束
    150: 'RUN_FINISH',                    # job在coordinator主流程结束
    155: 'KEY_PATH_END',                  # coordinator返回response给客户端
    160: 'START_PERSIST',                 # 开始persist
    165: 'SUMMARY_UPLOADED',              # Summary upload结束
    166: 'RECYCLE',                       # 开始回收job在NAS上的临时目录
    170: 'FINISHED',                      # persist结束
}
```

#### 用户透出的关键阶段

| 阶段名称 | Event范围 | 计算方式 | 说明 |
|---------|----------|---------|------|
| **Setup** | 100→108 | 108-100 | SQL初始化阶段，包含编译优化等操作 |
| **Resuming Cluster** | 110→112 | 112-110 | 等待启动VC耗时，如果长时间未拉起请联系技术支持 |
| **Queued** | 112→120 | 120-112 | 作业排队等待资源，如果耗时较长建议查看vc资源是否占满，建议扩容vc |
| **Running** | 120→130 | 130-120 | SQL处理数据时间，可以点到诊断查看每个算子耗时 |
| **Finish** | 130→150 | 150-130 | SQL结束时间，包含commit数据、auto merge等 |

#### 提取 Profiling 数据
```python
# 从 job_profile.json 提取
profiling_data = profile_data['data']['jobSummary']['jobProfiling']['profiling']

# 构建时间映射
profiling_map = {}
for entry in profiling_data:
    event_id = int(entry['e'])
    timestamp_ms = int(entry['t'])
    profiling_map[event_id] = timestamp_ms

# 示例数据结构:
# [
#   {"e": 100.0, "t": "1769626801341"},  # RECEIVE_SUBMIT
#   {"e": 101.0, "t": "1769626801341"},  # PRECHECK_START
#   {"e": 102.0, "t": "1769626801343"},  # PRECHECK_END
#   ...
# ]
```

#### 计算各阶段耗时
```python
def calculate_phase_durations(profiling_map):
    """计算各阶段耗时（毫秒）- 按照官方定义"""
    durations = {}
    
    # 1. Setup: SQL初始化阶段 (100 -> 108)
    if 100 in profiling_map and 108 in profiling_map:
        durations['setup'] = profiling_map[108] - profiling_map[100]
    
    # 2. Resuming Cluster: 启动VC (110 -> 112)
    if 110 in profiling_map and 112 in profiling_map:
        durations['resuming_cluster'] = profiling_map[112] - profiling_map[110]
    
    # 3. Queued: 等待资源 (112 -> 120)
    if 112 in profiling_map and 120 in profiling_map:
        durations['queued'] = profiling_map[120] - profiling_map[112]
    
    # 4. Running: SQL处理数据 (120 -> 130)
    if 120 in profiling_map and 130 in profiling_map:
        durations['running'] = profiling_map[130] - profiling_map[120]
    
    # 5. Finish: SQL结束 (130 -> 150)
    if 130 in profiling_map and 150 in profiling_map:
        durations['finish'] = profiling_map[150] - profiling_map[130]
    
    # 6. 总耗时 (100 -> 150)
    if 100 in profiling_map and 150 in profiling_map:
        durations['total'] = profiling_map[150] - profiling_map[100]
    
    return durations

# 使用示例
durations = calculate_phase_durations(profiling_map)
running_time_ms = durations.get('running', 0)
running_time_sec = running_time_ms / 1000
```

#### 关键阶段说明

根据官方定义，Job 生命周期分为以下几个关键阶段：

1. **Setup (100→108)**: SQL初始化阶段，包含编译优化等操作
   - 正常情况下应该很快（< 2s）
   - 如果耗时较长，可能是SQL过于复杂

2. **Resuming Cluster (110→112)**: 等待启动VC
   - 正常情况下应该很快（< 1s）
   - 如果长时间未拉起，请联系技术支持

3. **Queued (112→120)**: 作业排队等待资源
   - 正常情况下应该很快（< 5s）
   - 如果耗时较长，建议查看vc资源是否占满，考虑扩容vc

4. **Running (120→130)**: SQL处理数据时间
   - 这是核心计算阶段，通常占总时间的大部分
   - 可以点到诊断查看每个算子耗时

5. **Finish (130→150)**: SQL结束时间
   - 包含commit数据、auto merge等操作
   - 正常情况下应该较快

#### 实际案例分析
```python
# 示例数据
profiling_data = [
    {"e": 100, "t": 1769651401262},  # RECEIVE_SUBMIT
    {"e": 101, "t": 1769651401275},  # PRECHECK_START
    {"e": 102, "t": 1769651401276},  # PRECHECK_END
    {"e": 103, "t": 1769651401308},  # JOB_META_CREATED
    {"e": 106, "t": 1769651401308},  # COORDINATOR_RUN
    {"e": 108, "t": 1769651402595},  # PLAN_CREATED (1287ms)
    {"e": 110, "t": 1769651402606},  # SUBMIT_TO_RM
    {"e": 112, "t": 1769651402624},  # RM_APP_CREATED (18ms)
    {"e": 120, "t": 1769651402678},  # GOT_FIRST_RESOURCE (54ms)
    {"e": 130, "t": 1769651543219},  # DAG_COMPLETE (140,541ms = 140.5s)
    {"e": 131, "t": 1769651543350},  # DATA_COMMIT_START
    {"e": 150, "t": 1769651543739},  # RUN_FINISH (520ms)
    {"e": 155, "t": 1769651543864},  # KEY_PATH_END
]

# 分析结果（按照官方定义）
# - Setup (100→108): 1333ms (0.9%) - SQL初始化，包含编译优化
# - Resuming Cluster (110→112): 18ms (0.0%) - 启动VC
# - Queued (112→120): 54ms (0.0%) - 等待资源
# - Running (120→130): 140,541ms (98.1%) - SQL处理数据（主要耗时）
# - Finish (130→150): 520ms (0.4%) - SQL结束，包含commit等
# - 总耗时: 143,332ms (143.3s)
```

### Stage 统计
```python
profile = profile_data['data']['jobSummary']

for stage_id, stage_data in profile['stageSummary'].items():
    # 时间
    start = int(stage_data['startTime'])
    end = int(stage_data['endTime'])
    elapsed_ms = end - start
    
    # DOP
    dop = 0
    for count in stage_data['taskCountDetail'].values():
        dop += int(float(count))
    
    # IO 统计
    io = stage_data['inputOutputStats']
    input_bytes = int(io['inputBytes'])
    output_bytes = int(io['outputBytes'])
    spill_bytes = int(io['spillingBytes'])
```

### Operator 统计
```python
# Operator 性能
for op_id, op_data in stage_data['operatorSummary'].items():
    # 耗时
    wall_time = op_data['wallTimeNs']
    max_ns = int(wall_time['max'])
    avg_ns = int(wall_time['avg'])
    
    max_ms = max_ns / 1_000_000
    avg_ms = avg_ns / 1_000_000
    
    # 倾斜比率
    skew = max_ms / avg_ms if avg_ms > 0 else 1.0
    
    # Spilling
    if 'spillStats' in op_data:
        spill = op_data['spillStats']
        # 详细的 spill 信息
```

## 常用计算模式

### 计算占比
```python
# Stage 占总体百分比
stage_pct = (stage_elapsed_ms / total_job_time) * 100

# Operator 占 Stage 百分比
op_pct = (op_max_ms / stage_elapsed_ms) * 100
```

### 判断触发条件
```python
# 耗时阈值
is_slow = elapsed_ms > 12000 or (elapsed_ms / total_time * 100) > 15

# DOP 差异
dop_ratio = current_dop / upstream_dop
is_dop_diff = dop_ratio < 0.5

# 数据量阈值
data_gb = bytes / (1024**3)
is_large = data_gb > 10
```

### 搜索 Pattern
```python
# 使用 JSON 字符串搜索
plan_str = json.dumps(stage)

# Join 算法
is_broadcast = 'BroadcastHashJoin' in plan_str or 'Broadcast' in plan_str
is_shuffle = 'ShuffleHashJoin' in plan_str

# Aggregate 阶段
has_p1 = 'P1' in plan_str or 'PARTIAL1' in plan_str
is_complete = 'COMPLETE' in plan_str

# 高成本函数
has_expensive = any(f in plan_str for f in 
    ['MULTI_RANGE_COLLECT', '_DF_BF_COLLECT', 'BF_COLLECT'])

# TableSink
has_tablesink = 'TableSink' in plan_str
is_overwrite = 'OVERWRITE' in plan_str
is_delta = 'PhysicalTableSink_DELTA' in plan_str
```

## 典型分析示例

### 找瓶颈 Operator
```python
# 按耗时排序
sorted_ops = sorted(operator_analysis, 
                   key=lambda x: x['max_time_ms'], 
                   reverse=True)

bottleneck = sorted_ops[0]
```

### 计算上游 DOP
```python
upstream_dops = [
    stage_metrics[sid]['dop'] 
    for sid in stage_metrics 
    if sid != current_stage_id
]
max_upstream_dop = max(upstream_dops) if upstream_dops else 0
```

### 检查参数是否已存在
```python
def should_recommend(param, value):
    if param not in settings:
        return True
    if settings[param] != value:
        return True
    return False
```

## 常见陷阱

### ❌ 错误做法
```python
# 仅从 profile 判断 Join 类型
# profile 中没有算法信息！
join_type = ???  # 无法获取

# 忽略参数检查
optimizations.append(...)  # 可能重复推荐
```

### ✅ 正确做法
```python
# 从 plan 获取算法
plan_str = json.dumps(stage['operators'])
is_broadcast = 'BroadcastHashJoin' in plan_str

# 从 profile 获取性能
elapsed = stage_data['endTime'] - stage_data['startTime']

# 检查参数
if 'cz.optimizer.enable.broadcast.hash.join' not in settings:
    recommend(...)
```
