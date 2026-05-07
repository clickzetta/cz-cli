# 状态表优化指南

本文档包含增量计算的状态表优化规则。

这是增量优化的第二部分，基于增量算法分析的结果，提供具体的状态表优化建议。

**前置依赖**：
- 本文档的优化规则依赖于 [增量算法分析](./incremental-algorithm-analysis.md) 的结果
- 必须先完成增量算法识别（4.2.1）才能应用这些优化规则

**相关文档**：
- [Stage/Operator 优化](./stage-operator-optimization.md) - Stage 和 Operator 级别优化
- [增量算法分析](./incremental-algorithm-analysis.md) - 增量算法识别和分析（必读）
- [优化原则](./optimization-principles.md) - 参数推荐原则

---

## 状态表优化规则

### 4.2.2 非增量原因诊断

**触发条件**：
- Job **非增量刷新**（根据 4.2.1 判断）

**推荐操作**（根据版本选择）：

#### 版本 <= 1.3

**IF** job 非增量刷新 **AND** 版本 <= 1.3：
```sql
-- 推荐设置以下 flag 后重新执行 EXPLAIN REFRESH
set cz.optimizer.print.non.incremental.reason = true;
set cz.optimizer.print.non.incremental.reason.msg.max.length = 100000;
set cz.optimizer.incremental.force.incremental = true;
```

**THEN** 执行：
```sql
EXPLAIN REFRESH <表名>;
```

查看输出以了解为什么退化为全量刷新。

#### 版本 >= 1.4

**IF** job 非增量刷新 **AND** 版本 >= 1.4：
```sql
-- 推荐设置以下 flag
set cz.optimizer.incremental.try.incremental.refresh.enabled = true;
```

**THEN** 重新执行查询，系统会提示为什么没有走增量。

**版本判断**：
- 从 `plan.json` 的 `build_info` 或 `settings['build_info']` 中获取 `GitBranch` 信息
- 例如：`GitBranch:release-v1.3` → 版本 1.3
- 例如：`GitBranch:release-v1.4` → 版本 1.4

---

### 4.2.3 Window 算子在 append-only delta 输入时的优化

**目的**：优化 window 算子在 append-only delta 输入时的性能

**⚠️ 重要前提**：
- 根据 prompt 4.2.0 要求："同时关于状态表这些优化必须是对应算子的对应增量算法"
- **只有带增量 hint 的 window 算子才需要分析**
- 没有增量 hint 的 window 算子不是增量算法的一部分，应该跳过

**检查步骤**：

#### 步骤 0: 检查是否为增量算法的 window

**首先检查 window 算子是否有增量相关的 hint**：
```python
def has_incremental_hint(op):
    """检查是否有增量相关的 hint"""
    op_str = json.dumps(op)
    
    incremental_patterns = [
        'IncrementalLinearTopKWindowRule',
        'IncrementalLinearTopKWindowRuleV2', 
        'IncrementalWindowSetDeltaRule',
        'Rule:Incremental',
        'DeltaState',
        'HINT=delta'
    ]
    
    return any(pattern in op_str for pattern in incremental_patterns)

# 只处理有增量 hint 的 window
if not has_incremental_hint(window_op):
    continue  # 跳过，不是增量算法的 window
```

**示例**：
- ✅ **需要处理**：`HINT=delta,DeltaState-:[0,0]_IncrementalLinearTopKWindowRuleV2`
- ❌ **跳过处理**：普通的 `PhysicalWindow([ROW_NUMBER()])` 没有增量 hint

#### 步骤 1: 检查 window 算子的父节点

检查 window 算子的父节点是否是 calc，且存在 `row number=1` 的 pattern。

**rn=1 pattern 识别方法**：

可以通过以下两种方式识别：

1. **简单字符串匹配**（向后兼容）：
   - 查找 'ROW_NUMBER', 'row_number', 'rn=1', 'rn = 1' 等字符串

2. **JSON 结构匹配**（推荐）：
   - 查找 EQ function，其中 constant.bigint = "1"
   - EQ 表示等于 (=)，constant 有个值 bigint:1 表示是 1
   - 所以对应的其实就是 xx=1

**JSON 结构示例**：
```json
{
  "function": {
    "from": "",
    "name": "EQ",
    "builtIn": true,
    "arguments": [
      {
        "reference": {
          "id": "0",
          "local": false,
          "from": "",
          "name": "",
          "refType": "LOGICAL_FIELD"
        },
        "typeReference": 1
      },
      {
        "constant": {
          "bigint": "1"
        },
        "typeReference": 1
      }
    ],
    "properties": {"properties": []},
    "execDesc": "EQ(i64,i64)->b",
    "functionProperties": {"properties": []}
  },
  "pt": {
    "start": {"line": 1, "col": 7356, "pos": 7355},
    "end": {"line": 1, "col": 7364, "pos": 7363}
  },
  "typeReference": 13
}
```

**代码示例**：
```python
# 查找 window 算子
for idx, op in enumerate(operators):
    if 'window' in json.dumps(op).lower():
        # 检查父节点（下游算子）
        for parent_idx in range(idx + 1, len(operators)):
            parent_op = operators[parent_idx]
            if 'calc' in json.dumps(parent_op).lower():
                # 方法1: 简单字符串匹配
                parent_str = json.dumps(parent_op)
                if 'ROW_NUMBER' in parent_str or 'rn=1' in parent_str or 'rn = 1' in parent_str:
                    has_rn_pattern = True
                    break

                # 方法2: JSON 结构匹配（查找 EQ function with constant.bigint="1"）
                if check_eq_one_pattern(parent_op):
                    has_rn_pattern = True
                    break
```

#### 步骤 2: 检查 window 的输入是否是 append-only delta

使用 **4.2.1.5** 的方法检查 window 算子的输入是否是 append-only。

从 window 算子向上游遍历，找到所有 TableScan：

```python
def check_append_only_input(window_idx):
    visited = set()
    append_only_tables = {}

    def dfs(idx):
        if idx in visited:
            return
        visited.add(idx)

        op = operators[idx]

        # 如果是 tablescan，检查是否是 append-only
        if 'tableScan' in op:
            table_scan = op['tableScan']
            table_name = table_scan.get('table', {}).get('name', 'unknown')

            # 检查实际输出的列（operator的schema），而不是表定义的完整schema
            operator_schema = op.get('schema', {})
            struct_info = operator_schema.get('structTypeInfo', {})
            fields = struct_info.get('fields', [])
            # 检查是否输出 __incremental_deleted 列（注意是过去式）
            has_delete_col = any(f.get('name') == '__incremental_deleted' for f in fields)

            if not has_delete_col:
                # 是 append-only
                append_only_tables[table_name] = True

        # 继续向上游遍历
        for input_idx in get_inputs(idx):
            dfs(input_idx)

    dfs(window_idx)
    return len(append_only_tables) > 0, append_only_tables
```

#### 步骤 3: 优化建议

检查 window 算子是否包含 `IncrementalLinearTopKWindowRule` hint：
```python
window_str = json.dumps(window_op)
# 支持 V1 和 V2 版本的规则
uses_linear_topk_rule = ('IncrementalLinearTopKWindowRule' in window_str or 
                        'IncrementalLinearTopKWindowRuleV2' in window_str)
```

**IF** window 输入是 append-only **AND** 是 `rn=1` 的 pattern：

**情况 1：已使用 IncrementalLinearTopKWindowRule**
```python
if uses_linear_topk_rule:
    # 这是期望的行为，无需优化
    print("Window 算子已正确使用 IncrementalLinearTopKWindowRule 增量算法")
```

**情况 2：未使用 IncrementalLinearTopKWindowRule**
```python
if not uses_linear_topk_rule:
    # 需要优化：禁用竞争规则以启用 IncrementalLinearTopKWindowRule
    param = 'cz.optimizer.incremental.window.sd.to.sd.rule.enable'
    if param not in settings or settings.get(param) == 'true':
        # 推荐设置
        print("set cz.optimizer.incremental.window.sd.to.sd.rule.enable = false;")
```

**优化逻辑说明**：
- `cz.optimizer.incremental.window.sd.to.sd.rule.enable=false` 禁用其他 window 规则
- 这样可以让 `IncrementalLinearTopKWindowRule` 被选中使用
- 只有在 append-only + rn=1 场景下且未使用 linear rule 时才推荐

#### 步骤 4: 检查表 Property

**IF** 输入表是 Append-only：

检查 tablescan 的 table 属性是否有 `incr.append.only.table=true`：

```python
table_scan = op['tableScan']
table_properties = table_scan.get('table', {}).get('properties', {})
has_property = table_properties.get('incr.append.only.table') == 'true'
```

**IF** 没有设置：

检查 job 是否有 flag `cz.optimizer.incremental.append.only.tables`：

```python
append_only_setting = settings.get('cz.optimizer.incremental.append.only.tables', '')
if table_name not in append_only_setting:
    # 缺少 append-only hint
```

**推荐**：
```
⚠️ 提醒用户添加：
ALTER TABLE <表名> SET TBLPROPERTIES ('incr.append.only.table' = 'true');
-- 或
set cz.optimizer.incremental.append.only.tables = '<表名>';
```

---

### 4.2.4 Append-only Scan 检查

**目的**：检查当前 query 是否还包含 Append-only 的 scan，并预判算法是否最优

**核心思想**：
如果系统中仍然存在对 append-only 数据的扫描，说明可能没有充分利用 append-only 特性进行优化。理想情况下，append-only 数据应该通过增量算法处理，而不是重复扫描。

**检查逻辑**：

1. **识别 Append-only Delta 表**：
   ```python
   # 检查 TableScan 是否为 delta 表且不包含 __incremental_deleted 列（注意是过去式）
   # 检查位置：算子的实际输出列（operator.schema.structTypeInfo.fields）
   is_delta_table = (len(path) == 4 and path[-1] == '__delta__') or '__delta__' in table_name
   operator_schema = op.get('schema', {})
   struct_info = operator_schema.get('structTypeInfo', {})
   cols = [f.get('name') for f in struct_info.get('fields', [])]
   is_append_only = '__incremental_deleted' not in cols
   ```

2. **分析优化机会**：
   
   **IF** 发现 Append-only scan **AND** 有 Join/Aggregate 操作：
   
   a) **状态表检查**：
   ```python
   state_table_enabled = settings.get('cz.optimizer.incremental.enable.state.table', 'false') == 'true'
   if not state_table_enabled:
       # 建议：考虑启用状态表以避免重复扫描 append-only 数据
   ```
   
   b) **增量算法检查**：
   ```python
   has_incremental_hints = any(pattern in plan_str for pattern in [
       'IncrementalLinearTopKWindowRule',
       'IncrementalAggregateRule', 
       'IncrementalJoinRule',
       'Rule:Incremental',
       'DeltaState'
   ])
   if not has_incremental_hints:
       # 建议：可能可以使用增量计算替代全量扫描
   ```
   
   c) **综合评估**：
   ```python
   if not has_incremental_hints and not state_table_enabled:
       # 建议：append-only 数据特性未被充分利用，建议使用增量处理
   ```

**优化建议逻辑**：

- **问题**：为什么还在扫描 append-only 数据？
- **期望**：append-only 数据应该通过增量算法高效处理
- **建议**：
  1. 启用状态表避免重复扫描
  2. 使用增量算法替代全量扫描  
  3. 充分利用 append-only 数据特性

**示例输出**：
```
💡 Stage stg11: 表 ws1.namespace.table_a 是 append-only
[INFO] POTENTIAL_OPTIMIZATION - Stage stg11
       append-only 表 ws1.namespace.table_a 仍在进行扫描，
       考虑启用状态表以避免重复扫描 append-only 数据; 
       未检测到增量算法 hint，可能可以使用增量计算替代全量扫描; 
       append-only 数据特性未被充分利用，建议使用增量处理
```

---

### 4.2.5 状态表启用建议

**目的**：判断是否应该开启状态表以优化增量计算

**规则类型**：GlobalRule（全局规则，只执行一次）

**执行时机**：在"阶段2: 全局规则分析"中执行，不针对单个stage，而是分析整个job

**检查步骤**：

#### 步骤 1: 检查是否包含中间状态表

在整个 job 的所有 stage 中搜索表名包含 `__incr__` pattern 的 TableSink。

```python
def _check_job_has_state_table(context):
    """检查整个 job 是否已经包含中间状态表"""
    aligned_stages = context.get('aligned_stages', {})
    
    # 检查所有 stage 的 plan
    for stage_id, stage_data in aligned_stages.items():
        plan = stage_data.get('plan', {})
        plan_str = json.dumps(plan)
        if '__incr__' in plan_str:
            return True
            
    return False
```

**IF** 已包含中间状态表：
- 无需进一步检查
- 输出：`Job 已包含中间状态表（表名包含 __incr__）`

**注意**：此检查是全局的，不仅检查当前 stage，而是检查整个 job 的所有 stage。这避免了在某些 stage 中状态表已存在但其他 stage 仍建议开启状态表的误判。

#### 步骤 2: 判断是否值得存储中间状态

**考虑因素**：

1. **是否需要状态**（参考流计算的带状态计算定义）：
   - 有聚合计算（SUM, COUNT, MIN, MAX）
   - 有 Window 函数
   - 有 JOIN（需要保存 Join 状态）

   **重要**：只检查增量算法产生的算子，根据 prompt 4.2.1.2 要求：
   ```python
   def _get_incremental_stateful_ops(plan):
       """获取增量算法产生的状态算子列表"""
       incremental_stateful_ops = []
       operators = plan.get('operators', [])
       
       for op in operators:
           # 检查是否有增量 hint
           if not _has_incremental_hint(op):
               continue
               
           # 检查算子类型并匹配对应的增量算法
           op_str = json.dumps(op)
           
           # Join 算子：检查是否有对应的 Join 增量算法
           if ('Join' in op_str or 'HashJoin' in op_str) and 'Join' not in incremental_stateful_ops:
               join_patterns = [
                   'IncrementalJoinRule',
                   'Rule:Incremental.*Join',
                   'Rule:DeletePlan-delta-join'
               ]
               if any(pattern in op_str for pattern in join_patterns):
                   incremental_stateful_ops.append('Join')
           
           # Aggregate 算子：检查是否有对应的 Aggregate 增量算法
           elif ('HashAggregate' in op_str or 'Aggregate' in op_str) and 'HashAggregate' not in incremental_stateful_ops:
               agg_patterns = [
                   'IncrementalAggregateRule',
                   'IncrementalLinearFunctionAggregateRule',
                   'Rule:Incremental.*Aggregate',
                   'Rule:Incremental.*Agg'
               ]
               if any(pattern in op_str for pattern in agg_patterns):
                   incremental_stateful_ops.append('HashAggregate')
           
           # Window 算子：检查是否有对应的 Window 增量算法
           elif ('Window' in op_str or 'HashWindow' in op_str) and 'Window' not in incremental_stateful_ops:
               window_patterns = [
                   'IncrementalLinearTopKWindowRule',
                   'IncrementalLinearTopKWindowRuleV2',
                   'IncrementalWindowSetDeltaRule',
                   'Rule:Incremental.*Window'
               ]
               if any(pattern in op_str for pattern in window_patterns):
                   incremental_stateful_ops.append('Window')
       
       return incremental_stateful_ops

   if not incremental_stateful_ops:
       # 不包含增量算法产生的状态算子，无需开启状态表
       return
   ```

   **新增要求**：需要区分增量算法是不是对应的增量算法，如：
   - Join 算子对应的 rule 是 join 相关的增量算法
   - Aggregate 算子对应的 rule 是 aggregate 相关的增量算法  
   - Window 算子对应的 rule 是 window 相关的增量算法
   - 除非是第一次出现 hint 的 operator，否则应该都有对应关系
   - 不要错误把一些增量算法的中间算子当作自己本身
   
   **重要**：使用 `elif` 确保每个算子只能匹配一种类型，避免一个算子被错误地归类为多种类型。例如，一个 Join 算子如果有 Aggregate 相关的 rule，不应该被当作 Aggregate 算子处理。

#### 步骤 3: 两个正交的状态表优化策略

**策略1：基于增量算法的状态表优化**
- 通过程序级别的参数控制是否启用，不依赖被分析job的参数
- 控制方式：
  - 调用时传入：`context['enable_incremental_algorithm_analysis'] = True`
  - 环境变量：`ENABLE_INCREMENTAL_ALGORITHM_ANALYSIS=true`
  - 配置文件：`analysis.enable_incremental_algorithm = true`
  - 命令行参数：`--enable-incremental-algorithm`
- 默认不启用，避免浪费分析时间
- 检查是否包含增量算法产生的状态算子（HashAggregate, Window, Join）

**策略2：基于Snapshot Subplan占比的状态表优化（最重要）**
- **核心原理**：中间表之所以要创建不就是因为它计算的subplan是类似跑了全量，所以才需要的，这个是最重要的
- 总是执行，因为这是最重要的判断依据
- 基于operator级别的链路关系，不是stage级别
- 结合3.6的operator统计和4.2.1的delta/snapshot分析
- 找到某个subplan（root节点是snapshot）的统计耗时占比

**程序级别控制示例**：
```bash
# 方式1：命令行参数控制（推荐）
python analyze_job.py plan.json job_profile.json --enable-incremental-algorithm

# 方式2：同时启用状态表分析和增量算法策略
python analyze_job.py plan.json job_profile.json --enable-state-table --enable-incremental-algorithm

# 方式3：只启用状态表分析（不启用增量算法策略）
python analyze_job.py plan.json job_profile.json --enable-state-table
```

**参数传递链路**：
```
命令行参数 --enable-incremental-algorithm
    ↓
analyze_job.py 中的 enable_incremental_algorithm_analysis 参数
    ↓
context['enable_incremental_algorithm_analysis'] = True
    ↓
StateTableEnable.analyze() 中读取并控制策略启用
```

**代码实现**：
```python
# analyze_job.py
def analyze_job(plan_file, profile_file, output_dir=".", 
               enable_state_table_analysis=False,
               enable_incremental_algorithm_analysis=False):
    # ...
    analyzer.context['enable_incremental_algorithm_analysis'] = enable_incremental_algorithm_analysis

# state_table_enable.py  
def analyze(self, stage_data, context):
    enable_incremental_strategy = context.get('enable_incremental_algorithm_analysis', False)
    if enable_incremental_strategy:
        # 执行增量算法策略分析
        pass
```

**重要说明**：
- 这是分析程序自己的控制参数，不是被分析job的参数
- 不会推荐用户设置新的job参数（遵循prompt第8条）
- 只推荐已知有效的job参数：`cz.optimizer.incremental.enable.state.table=true`

**Snapshot Subplan分析逻辑**：
```python
def _find_snapshot_subplans(operator_data_types, operator_analysis, context):
    """
    找到root节点是snapshot的subplan
    
    1. 结合3.6的operator统计和4.2.1的delta/snapshot分析
    2. 基于operator级别的链路关系，不是stage级别  
    3. 找到某个subplan（root节点是snapshot）的统计耗时占比
    """
    # 找到所有snapshot类型的operator作为潜在的root节点
    snapshot_operators = [op_id for op_id, data_type in operator_data_types.items() 
                         if data_type == 'snapshot']
    
    # 获取operator依赖关系（来自增量算法分析器）
    operator_dependencies = _get_operator_dependencies(context)
    
    subplans = []
    for root_op in snapshot_operators:
        # 从root节点开始，找到整个snapshot subplan
        subplan_ops = _trace_snapshot_subplan(root_op, operator_data_types, operator_dependencies)
        
        # 计算subplan的总耗时占比
        total_time_ms = sum(op_time_map[op_id]['elapsed_ms'] for op_id in subplan_ops)
        percentage = (total_time_ms / total_job_time * 100)
        
        if percentage >= 15.0:
            # 推荐创建中间状态表
            pass
    
    return subplans
```

**策略执行逻辑**：
```python
def analyze_global(self, context: Dict) -> Dict:
    """全局分析：分析整个job的snapshot subplan（只执行一次）"""
    
    # 策略1：基于增量算法的状态表优化（程序控制是否启用）
    enable_incremental_strategy = context.get('enable_incremental_algorithm_analysis', False)
    if enable_incremental_strategy:
        incremental_result = self._analyze_incremental_algorithm_strategy_global(context)
        # 合并结果
    
    # 策略2：基于Snapshot subplan占比的状态表优化（总是执行，最重要）
    snapshot_result = self._analyze_snapshot_subplan_strategy(context)
    # 合并结果
    
    return results
```

**关键改进（2024年修复）**：
1. **全局分析**：StateTableEnable 改为 GlobalRule，只执行一次，不是每个stage执行一次
2. **公共节点处理**：对于全snapshot的subplan，公共节点也属于subplan（不跳过processed_operators）
3. **具体物化信息**：输出具体的root节点和所在stage，如"建议在 Stage stg18 的算子 HashJoin27 处物化为中间状态表"
4. **详细日志**：每个subplan都打印完整信息（序号、root、stage、占比、算子数量、决策）

**日志输出示例**：
```
[INFO] [StateTableEnable] 开始全局分析
[INFO] [StateTableEnable] Snapshot策略 - 找到 5 个 snapshot subplan

[INFO] Snapshot策略 - Subplan 1/5: Root=HashJoin27 (Stage stg18), 占比=28.9% (52468ms / 181357ms), 包含13个算子
[INFO] Snapshot策略 - ✓ Subplan 1 占比 28.9% >= 15%，建议在 Stage stg18 的算子 HashJoin27 处物化为中间状态表

[INFO] Snapshot策略 - Subplan 2/5: Root=HashJoin154 (Stage stg14), 占比=6.8% (12389ms / 181357ms), 包含12个算子
[INFO] Snapshot策略 - ✗ Subplan 2 占比 6.8% < 15%，不建议创建状态表

[INFO] [StateTableEnable] 全局分析完成: 总共 1 findings, 1 recommendations
```

**输出示例**：
```
[增量策略] 包含 HashAggregate，状态表大小预估合理，建议开启状态表以避免重复计算
[Snapshot策略] 发现高占比subplan (18.5%)：Aggregate(SUM,COUNT, 1200ms) -> Join(INNER, 800ms) -> TableScan(ws1.test_table, 500ms)
```

**Snapshot 骨架输出**：
- 同时打印出该 snapshot 的"骨架"，即把重要算子打印出来，如 aggregate/join/window/tablescan
- aggregate 打印出聚集函数，window 类似
- 这样方便从原始 sql 找到对应的 sql，这样 join 等就知道是从哪个 tablescan 开始到哪里结束需要创建中间表

```python
def _analyze_snapshot_operators(context):
    """分析 snapshot 算子的占比"""
    operator_data_types = context.get('operator_data_types', {})
    operator_analysis = context.get('operator_analysis', [])
    total_job_time = context.get('total_job_time', 0)
    
    # 找出所有 snapshot 算子及其耗时
    snapshot_operators = []
    total_snapshot_time = 0
    
    for op_analysis in operator_analysis:
        op_id = op_analysis.get('operator_id', '')
        elapsed_ms = op_analysis.get('elapsed_ms', 0)
        
        # 检查是否是 snapshot 算子
        if op_id in operator_data_types and operator_data_types[op_id] == 'snapshot':
            snapshot_operators.append({
                'operator_id': op_id,
                'stage_id': op_analysis.get('stage_id', ''),
                'elapsed_ms': elapsed_ms,
                'operator_type': _get_operator_type(op_analysis)
            })
            total_snapshot_time += elapsed_ms
    
    # 计算占比
    total_percentage = (total_snapshot_time / total_job_time * 100) if total_job_time > 0 else 0.0
    
    # 构建骨架信息（重要算子：aggregate/join/window/tablescan）
    skeleton = _build_snapshot_skeleton(snapshot_operators, context)
    
    return {
        'total_percentage': total_percentage,
        'skeleton': skeleton
    }

def _build_snapshot_skeleton(snapshot_operators, context):
    """构建 snapshot 算子的骨架信息"""
    # 按重要性排序：aggregate > join > window > tablescan
    important_ops = [op for op in snapshot_operators 
                    if op['operator_type'] in ['aggregate', 'join', 'window', 'tablescan']]
    
    # 按重要性和耗时排序
    important_ops.sort(key=lambda x: (importance_order.get(x['operator_type'], 5), -x['elapsed_ms']))
    
    skeleton = []
    for op in important_ops[:10]:  # 只取前10个重要算子
        skeleton_item = {
            'stage_id': op['stage_id'],
            'operator_id': op['operator_id'],
            'type': op['operator_type'],
            'elapsed_ms': op['elapsed_ms'],
            'details': extract_operator_details(op, context)  # 提取聚集函数、窗口函数等
        }
        skeleton.append(skeleton_item)
    
    return skeleton
```

**输出示例**：
```
Stage stg5: Snapshot 算子占比 18.5% >= 15%，建议开启状态表以减少重复计算
Stage stg5: Snapshot 算子骨架：Aggregate(SUM,COUNT, 1200ms) -> Join(INNER, 800ms) -> TableScan(ws1.test_table, 500ms)
```

   **增量 hint 检查**：
   ```python
   def _has_incremental_hint(op):
       """检查算子是否有增量相关的 hint"""
       op_str = json.dumps(op)
       incremental_patterns = [
           'IncrementalLinearTopKWindowRule',
           'IncrementalLinearTopKWindowRuleV2', 
           'IncrementalWindowSetDeltaRule',
           'IncrementalAggregateRule',
           'IncrementalJoinRule',
           'Rule:Incremental',
           'DeltaState',
           'HINT=delta'
       ]
       
       for pattern in incremental_patterns:
           if pattern in op_str:
               return True
       return False
   ```

2. **状态表是否会过大**：
   - 根据每一步的 stats 信息（inputBytes, outputBytes）
   - 根据输入表的增量数据大小
   - 判断状态表大小是否可接受

   ```python
   output_bytes = metrics.get('output_bytes', 0)
   input_bytes = metrics.get('input_bytes', 0)

   if input_bytes == 0:
       # 无法判断，保守建议开启
       should_enable = True
   else:
       size_ratio = output_bytes / input_bytes
       STATE_SIZE_RATIO_THRESHOLD = 10  # 阈值

       if size_ratio > STATE_SIZE_RATIO_THRESHOLD:
           # 状态表可能过大
           should_enable = False
           reason = f"状态表可能过大（输出/输入比例={size_ratio:.1f}x，阈值={STATE_SIZE_RATIO_THRESHOLD}x）"
       else:
           # 状态表大小合理
           should_enable = True
           reason = f"包含 {', '.join(stateful_ops)}，状态表大小预估合理（输出/输入比例={size_ratio:.1f}x）"
   ```

#### 步骤 3: 推荐参数

**IF** 不包含状态表 **AND** 值得存储中间状态：

搜索 settings 中 `cz.optimizer.incremental.enable.state.table`：

**IF** 参数不存在 **OR** 值 = `false`：
```sql
-- 推荐
set cz.optimizer.incremental.enable.state.table = true;
```

**附加说明**：
```
状态表大小预估: <size> GB
增量数据大小: <delta_size> GB
建议: 开启状态表可以避免重复计算
```

---

### 4.2.6 Aggregate 复用检查

**目的**：检查 Aggregate 计算是否利用了之前的计算结果

**期望行为**：
- **SUM, COUNT**: 无论如何都应尽量使用之前的结果
- **MIN, MAX**: 在 Append-only 情况下应尽量使用之前的结果

**检查步骤**：

#### 步骤 1: 找到原始 SQL 的 Aggregate operator

**重要**：aggregate 必须设置上了 hint 包含类似 4.2.1.2 的一些状态 hint。

如果不包含，说明该 aggregate 算子不是原始 sql 中的 aggregate，而是其他优化器 rule 等自己生成的，这些不需要检查。

```python
def has_incremental_hint(op):
    """检查算子是否有增量 hint"""
    op_str = json.dumps(op)

    # 检查是否包含增量相关的 Rule hint
    incremental_patterns = [
        'IncrementalLinearFunctionAggregateRule',
        'IncrementalAggPositiveDeltaDedupRule',
        'IncrementalAggregate',
        'Rule:Incremental.*Aggregate',
        'Rule:Incremental.*Agg'
    ]

    for pattern in incremental_patterns:
        if pattern in op_str:
            return True

    return False

# 过滤掉增量算法的辅助 aggregate
for op in stage['operators']:
    if 'hashAgg' in op or 'hashAggregate' in op:
        # 检查是否是辅助 aggregate（P1/P2 阶段）
        if is_incremental_helper_aggregate(op):
            continue

        # 检查是否有增量 hint
        if not has_incremental_hint(op):
            continue  # 不是原始 SQL 的 aggregate

        # 提取 aggregate 函数
        agg_calls = op['hashAgg']['aggregate']['aggregateCalls']
        for call in agg_calls:
            func_name = call['function']['function']['name']
            # 检查是否是 SUM, COUNT, MIN, MAX
```

#### 步骤 2: 检查是否利用了之前的计算结果

在 Aggregate 的 properties 或上游 Scan 中查找增量计算相关标识。

```python
def check_incremental_markers(plan):
    """检查是否有增量标记"""
    plan_str = json.dumps(plan).lower()
    return any(m in plan_str for m in ['incremental', 'delta', 'state', 'partial_result'])

has_incremental_marker = check_incremental_markers(plan)
```

**IF** 发现没有复用之前的结果：

#### 步骤 3: 检查是否存在状态

使用 **4.2.5** 的方法检查状态表。

```python
def check_state_table_exists(plan):
    """检查是否存在状态表"""
    plan_str = json.dumps(plan)
    return '__incr__' in plan_str

has_state_table = check_state_table_exists(plan)
```

**IF** 状态不存在：
```
⚠️ 建议：可能缺少状态表，建议设置 cz.optimizer.incremental.enable.state.table=true
```

#### 步骤 4: 检查是否有 Append-only 输入

使用 **4.2.1.5** 的方法检查 aggregate 的输入是否是 append-only。

```python
def check_append_only_inputs(plan, agg_idx):
    """检查 aggregate 的输入是否是 append-only"""
    # 从 aggregate 向上游遍历，找到所有 tablescan
    # 检查实际输出的列（operator.schema.structTypeInfo.fields）
    # 检查是否输出 __incremental_deleted 列（注意是过去式）
    # 如果没有输出，则是 append-only
    pass

is_append_only = check_append_only_inputs(plan, agg_idx)
```

**IF** 是 Append-only **BUT** 缺少系统 hint：

```
⚠️ 建议补充 hint:
ALTER TABLE <表名> SET TBLPROPERTIES ('incr.append.only.table' = 'true');
-- 或
set cz.optimizer.incremental.append.only.tables = '<表名>';
```

#### 步骤 5: 分析不同聚集函数

**对于 SUM, COUNT**：
- 无论如何都应该使用之前的结果
- 如果没有复用，给出 WARNING 级别的 finding

**对于 MIN, MAX**：
- 在 append-only 情况下应该使用之前的结果
- 如果是 append-only 但没有复用，给出 INFO 级别的 finding

**示例输出**：
```
发现 Aggregate: SUM(amount)
检查: 没有利用之前的计算结果
原因: 输入表 orders 是 Append-only 但缺少 hint
建议: 添加 'incr.append.only.table' = 'true' property
```

---

### 4.2.7 Calc 状态优化

**触发条件**（必须**全部**满足）：
1. Calc operator 占其所属 Stage 耗时 **> 30%**
2. 该 Stage 占整体耗时 **> 10%**

**检查步骤**：

#### 步骤 1: 识别高耗时 Calc

```python
for op in operator_analysis:
    if 'Calc' in op['operator_id']:
        if op['stage_pct'] > 30 and stage_total_pct > 10:
            # 触发优化检查
```

#### 步骤 2: 分析 Calc 内容

在 plan 中查看 Calc operator 的详细内容：

```python
calc_op = find_operator(plan, 'calc')
expressions = calc_op['calc']['expressions']

# 检查是否有高成本函数
for expr in expressions:
    if is_udf(expr) or is_complex_function(expr):
        has_heavy_calc = True
```

#### 步骤 3: 特别关注 UDF

**IF** Calc 包含**用户自定义函数（UDF）**：
- UDF 通常耗时较长
- 非常适合通过状态表优化

#### 步骤 4: 推荐参数

**IF** 发现高耗时 Calc（特别是包含 UDF）：

搜索 settings 中 `cz.optimizer.incremental.create.rule.based.table.on.heavy.calc`：

**IF** 参数不存在 **OR** 值 = `false`：
```sql
-- 推荐
set cz.optimizer.incremental.create.rule.based.table.on.heavy.calc = true;
```

**示例输出**：
```
发现高耗时 Calc: Calc25
  Stage 占比: 45.2%
  整体占比: 12.3%
  包含 UDF: my_custom_transform()
建议: 开启 Calc 状态优化
  set cz.optimizer.incremental.create.rule.based.table.on.heavy.calc = true;
```

#### 步骤 5: 显示所有满足的优化模式

**重要**：总体所有满足这些优化 pattern 的（4.2.3-4.2.7），请可以显示出来，提供查看。

这包括：
- 4.2.3: Window 算子在 append-only delta 输入时的优化机会
- 4.2.4: 基于 append-only scan 的优化机会
- 4.2.5: 中间状态表创建的优化机会
- 4.2.6: Aggregate linear rule 优化机会
- 4.2.7: Calc 状态优化机会

**输出格式**：
```
优化机会总览：
1. [Window优化] Stage 3: Window 算子输入是 append-only 且有 rn=1 pattern
2. [状态表优化] Stage 5: Aggregate SUM/COUNT 可以利用状态表
3. [Calc优化] Stage 7: Calc 包含 UDF，占比 45.2%
...
```

---

