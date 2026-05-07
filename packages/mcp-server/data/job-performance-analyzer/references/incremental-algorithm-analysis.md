# 增量算法分析指南

本文档包含增量计算的算法识别和分析规则。

这是增量优化的核心部分，用于识别和分析增量算法，为状态表优化提供基础。

**相关文档**：
- [Stage/Operator 优化](./stage-operator-optimization.md) - Stage 和 Operator 级别优化
- [状态表优化](./state-table-optimization.md) - 状态表相关优化规则（依赖本文档的分析结果）
- [优化原则](./optimization-principles.md) - 参数推荐原则

---

## 状态表优化前提

**⚠️ 重要：启用条件**

状态表优化分析**默认禁用**，只有在以下情况下才会执行：
- 用户在 prompt 中**明确提到**需要"状态表优化"
- 命令行使用 `--enable-state-table` 参数

**原因**：根据 prompt 4.2.0 的要求，如果用户没有提到使用状态表优化，则不需要使用下面的优化原则来优化。

**使用方式**：
```bash
# 禁用状态表分析（默认）
cz-analyze-job plan.json job_profile.json

# 启用状态表分析
cz-analyze-job plan.json job_profile.json --enable-state-table
```

**Claude Skill 使用**：
- 基本分析："分析这两个文件的性能问题"
- 包含状态表优化："分析这两个文件的性能问题，包括状态表优化"

---

## 增量算法分析

### 4.2.1 判断是否增量刷新及增量算法分析

**目的**：确认当前 job 是否为增量刷新，并识别增量算法

本节包含四个子步骤（4.2.1.1-4.2.1.4），对应增量算法的完整分析流程。

#### 4.2.1.1 识别所有 operator 是 delta 还是 snapshot

**第一步：判断是否增量刷新**
使用 **4.1.1** 的方法判断。

**第二步：识别增量数据**（仅当是增量 plan 时）
如果是增量计算的 plan，需要收集哪些表是增量数据，哪些是读 snapshot。

**数据提取**：
```python
# 从 TableScan operator 中获取 incrementalTableProperty
table_scan = operator['tableScan']
incr_property = table_scan.get('incrementalTableProperty', {})
from_version = incr_property.get('from')
to_version = incr_property.get('to')
```

**版本号含义**：

`incrementalTableProperty` 有 `from/to` 字段，记录了版本范围：

| from | to | 含义 | 说明 |
|------|-----|------|------|
| 28800 | 57600 | **Delta 数据** | 从版本 28800 到 57600 的增量数据 |
| -9223372036854775808 | 28800 | **上个 Snapshot** | 版本 28800 的完整状态（上个状态） |
| -9223372036854775808 | 57600 | **当前 Snapshot** | 版本 57600 的完整状态（当前状态） |

**判断规则**（根据 original_prompt.md 第 49 行）：
- **Delta 数据**：只有当 `from` 和 `to` 都是非 MIN_LONG 值时（如 `from=28800, to=57600`）
- **Snapshot 数据**：`from=-9223372036854775808`（MIN_LONG）是明显特征

**增量计算公式**：
```
上个 Snapshot (from=-9223372036854775808, to=28800) + Delta (from=28800, to=57600) = 当前 Snapshot (from=-9223372036854775808, to=57600)
```

**示例**：
```python
# 示例 1: Delta 数据
{
  "from": "28800",
  "to": "57600",
  "fromMetaVersion": "0",
  "toMetaVersion": "0"
}
# → 这是从 28800 到 57600 的增量数据（from 和 to 都不是 MIN_LONG）

# 示例 2: 上个 Snapshot
{
  "from": "-9223372036854775808",
  "to": "28800",
  "fromMetaVersion": "0",
  "toMetaVersion": "0"
}
# → 这是版本 28800 的完整状态（from 是 MIN_LONG）

# 示例 3: 当前 Snapshot
{
  "from": "-9223372036854775808",
  "to": "57600",
  "fromMetaVersion": "0",
  "toMetaVersion": "0"
}
# → 这是版本 57600 的完整状态（from 是 MIN_LONG）
```

**第三步：Delta/Snapshot 传播规则**

通过分析算子的输入输出，自动推导每个算子处理的是 delta 还是 snapshot 数据。

**传播规则**：

1. **一元算子**（Filter, Project, Calc 等）：
   - 输入是 delta → 输出是 delta
   - 输入是 snapshot → 输出是 snapshot
   ```
   Filter(delta) = delta
   Filter(snapshot) = snapshot
   ```

2. **Join 算子**：
   - **只有** left 和 right **都是 snapshot**，结果才是 snapshot
   - 其他情况（有任何一个是 delta）结果都是 delta
   ```
   Join(snapshot, snapshot) = snapshot
   Join(delta, snapshot) = delta
   Join(snapshot, delta) = delta
   Join(delta, delta) = delta
   ```

3. **Union 算子**：
   - 所有输入都是 snapshot → 输出是 snapshot
   - 所有输入都是 delta → 输出是 delta
   - 部分 delta，部分 snapshot → 输出是 snapshot（但这种情况很少见）
   ```
   Union(snapshot, snapshot, ...) = snapshot
   Union(delta, delta, ...) = delta
   ```

4. **其他多元算子**：
   - 一般按照 Union 规则处理
   - 如果遇到特殊情况，需要单独分析

5. **⚠️ 增量算法 Hint 优先规则**（重要补充）：
   - **如果算子有增量算法 hint**（如 `IncrementalJoinRule`, `IncrementalAggregateRule` 等），**该算子应该被标记为 delta**
   - 这是因为增量算法是用来处理增量数据的，即使输入是 snapshot，增量算法也会输出 delta
   - **增量算法的语义**：可以接受 SNAPSHOT 输入并产生 DELTA 输出（通过比较两个 snapshot 计算差异）
   - **检查方法**：在算子的 JSON 中查找 `Incremental` 或 `DeltaState` 关键字
   - **优先级**：增量 hint 检查应该在基于输入的传播规则之前执行

   ```python
   # 示例：HashJoin 有增量 hint
   if 'Incremental' in json.dumps(operator) or 'DeltaState' in json.dumps(operator):
       operator_type = DataType.DELTA  # 直接标记为 delta
   else:
       # 使用基于输入的传播规则
       operator_type = infer_from_inputs(...)
   ```

   **实际案例**：
   ```
   HashJoin30 (有 IncrementalJoinWithoutCondenseRule hint)
   ├── ShuffleRead31 → SNAPSHOT (来自 snapshot TableScan)
   └── ShuffleRead92 → DELTA (来自 delta TableScan)

   结果：HashJoin30 = DELTA（因为有增量 hint，而不是基于输入判断）
   ```

#### 4.2.1.2 识别不同算子的增量算法

**目的**：识别不同算子的增量算法，区分真正的 join/aggregate/window 增量算子和算法的一部分

##### Rule Hint 解析

增量算法会在算子上添加 Rule hint，用于标识算子属于哪个增量算法。

**Rule Hint 格式**：

1. **不带 ID 的 Rule**：
   ```
   Rule:IncrementalLinearFunctionAggregateRule
   ```
   - 表示这是增量 Aggregate 算法的一部分
   - Rule 名称包含算子类型（Aggregate/Join/Window）

2. **带 ID 的 Rule**：
   ```
   Rule:IncrementalJoinWithoutCondenseRule_cz::optimizer::LogicalJoin#31766417
   ```
   - `LogicalJoin#31766417` 是算子 ID
   - 所有带相同 ID 的算子都是为了计算同一个 Join 的增量算法
   - 用于识别增量算法的边界

3. **HINT= 格式（新增，包含 DeltaState 信息）**：
   ```
   HINT=delta,DeltaState:[1,1896] - [1,6393]_IncrementalWindowSetDeltaRule#cz::optimizer::Window#293342
   ```
   - `HINT=delta` 表示计算 delta 数据来优化
   - `DeltaState:[1,1896] - [1,6393]` 表示该算子是整体增量算法的状态算子
   - `IncrementalWindowSetDeltaRule` 是使用的增量算法
   - `Window#293342` 表示是对哪个算子计算了增量算法
   - 这种 hint 提供了更详细的状态信息，用于识别增量算法的状态边界

4. **⚠️ DeletePlan Rule（必须作为边界终止遍历）**：
   ```
   Rule:DeletePlan-delta-join(left)_Delta:L_Snapshot:R
   ```
   - **DeletePlan 相关的 hint 不属于任何增量算法**
   - 这些 hint 用于表示删除数据的 plan
   - **在识别增量算法时的处理**：
     - **解析阶段**：过滤掉所有包含 `DeletePlan` 的 Rule hint（不作为算法起点）
     - **遍历阶段**：如果在执行路径中遇到 DeletePlan 算子，**必须终止遍历**
   - **为什么必须终止而不是跳过**：
     - DeletePlan 算子在执行路径中表示删除操作
     - 如果跳过 DeletePlan 继续查找，找到的 subplan 会缺少中间算子（不完整）
     - 由于 plan 是执行路径不能跳过，所以遇到 DeletePlan 必须终止

**Rule Hint 的作用**：

- **识别算法类型**：从 Rule 名称判断是 Aggregate/Join/Window 算法
- **识别算法边界**：通过 ID 找到属于同一个算法的所有算子
- **区分原始算子**：
  - 如果 Rule 出现在对应类型的算子上（如 Aggregate Rule 在 Aggregate 算子上）→ 原始 SQL 算子
  - 如果 Rule 出现在其他类型的算子上（如 Aggregate Rule 在 Join 算子上）→ 算法辅助算子
- **处理 DeletePlan 算子**：
  - **解析阶段**：包含 `DeletePlan` 的 Rule hint 不作为算法起点
  - **遍历阶段**：遇到 DeletePlan 算子作为边界条件，终止遍历

#### 4.2.1.3 算子增量算法对应的 subplan

**目的**：找到一个增量算法对应的所有算子，识别算子对应的 root 阶段

**⚠️ 重要说明**：

1. **完整的执行 subplan，不是零散的 hint operator**：
   - 算子增量算法对应的 subplan **不是**让你把 rule 相同的合在一起
   - rule 相同的算子肯定来源于同一个算子对应的增量算法
   - 而是要把某一个增量算法涉及到的**所有算子**都包含起来
   - 这些算子**不一定有 Rule 这些 hint**
   - 他们是一个执行的 subplan，而不是这些零散的 hint operator 组成

   **示例**：
   ```
   假设有增量 Aggregate 算法：
   - TableScan (delta) - 没有 Rule hint，但是算法的输入
   - TableScan (snapshot) - 没有 Rule hint，但是算法的输入
   - Join - 有 Rule hint（为 Aggregate 准备数据）
   - Calc - 没有 Rule hint，但在算法执行路径中
   - Aggregate (P1) - 有 Rule hint
   - Aggregate (P2) - 有 Rule hint
   - Aggregate (Final) - 有 Rule hint

   完整 subplan 应该包含所有 7 个算子，而不仅仅是有 hint 的 4 个算子
   ```

2. **使用 plan.json 的实际 operator ID，不是数组索引**：
   - 在 plan.json 里找到所有 operator 对应的 Id
   - 注意这里的 **ID 不是代码中那些 index 下标**
   - 应该使用 plan.json 中算子对象的 `"id"` 字段的实际值
   - 例如：`"id": "12345"` 应使用 `"12345"` 而不是数组索引 `0`

3. **⚠️ 处理没有 ID 的 Rule Hint（新增逻辑 - 两阶段方法）**：

   根据 4.2.1.2 找到相同增量算法的算子后，需要采用**两阶段方法**来构建完整的 subplan：

   **阶段1：构建初始确定集合（在 `_parse_rule_hints()` 中完成）**

   目的：复用 4.2.1.2 的逻辑，找到所有带hint的算子（有ID和无ID），形成确定集合

   **步骤 1.1：解析有ID的hint**
   - 格式：`Rule:IncrementalAggregateSetDeltaRuleV2#5402883`
   - 存储在 `self.rule_groups` 中：`{algorithm_id: [operator_indices]}`

   **步骤 1.2：解析无ID的hint**
   - 格式：`HINT=Rule:IncrementalAggregateSetDeltaRuleV2_Delta:R_Snapshot:L`
   - 存储在 `self.operator_rule_names` 中：`{operator_index: rule_name}`

   **步骤 1.3：匹配无ID的hint到算法**
   - 调用 `_assign_hints_without_id_to_algorithms()`
   - 对于每个无ID的hint，向下游查找匹配的算法
   - **关键**：匹配条件是 **算子类型相同 AND rule名称相似**
   - 使用 `_find_matching_algorithm_downstream_by_name()` 进行匹配：
     - 提取基础rule名称（去除版本号V2等）
     - BFS向下游搜索
     - 找到第一个算子类型和rule名称都匹配的算法
   - 将匹配的算子加入对应算法的 `rule_groups`

   **阶段2：从确定集合扩展到完整subplan（在 `_identify_incremental_algorithms_with_subplan()` 中完成）**

   目的：从确定集合（rule_groups）出发，使用边界规则遍历上下游，得到完整的subplan

   **⚠️ 重要：使用两个独立的循环**

   根据用户反馈："应该先全部遍历一遍增量算法，得到所有的确定性的相关subplan后，再继续后续操作"

   **第一个循环：为所有算法构建确定集合**
   - 遍历所有算法
   - 对每个算法调用 `_connect_hint_operators_for_algorithm()`
   - 找到所有hint算子之间的连通路径
   - 存储所有算法的确定集合

   **第二个循环：从确定集合扩展到完整subplan**
   - 遍历所有算法
   - 使用第一个循环构建的确定集合
   - 调用 `_find_algorithm_subplan_from_confirmed_set()` 扩展
   - 使用边界规则判断是否继续添加算子

   **步骤 2.1：第一个循环 - 构建所有确定集合**
   - 调用 `_connect_hint_operators_for_algorithm()` 为每个算法
   - 找到所有hint算子之间的连通路径
   - 根据 prompt："这些算子联通(遍历)起来的算子一定属于该算法的subplan一部分"
   - 例如：如果有 hint 算子 A 和 D，且它们之间有路径 A→B→C→D，则 B 和 C 也属于确定集合
   - 存储在 `all_confirmed_sets` 字典中

   **步骤 2.2：第二个循环 - 扩展到完整subplan**
   - 使用第一个循环构建的确定集合作为起点
   - 这些算子已经包含了有ID和无ID的hint算子，以及它们之间的连通路径

   **步骤 2.3：调用 `_find_algorithm_subplan_from_confirmed_set()`**
   - 从确定集合的每个算子出发
   - 向上游和下游遍历
   - 使用边界规则判断是否继续添加算子

   **步骤 2.4：得到完整subplan**
   - 确定集合 + 扩展的算子 = 完整subplan
   - 直到所有方向都遇到边界为止

   **代码实现要点**：
   ```python
   # ========== 阶段1：在 _parse_rule_hints() 中完成 ==========
   def _parse_rule_hints(self):
       # 1. 解析有ID的hint → 存入 rule_groups
       for idx, op in enumerate(self.operators):
           # ... 解析 Rule:IncrementalXxxRule#ID ...
           if algorithm_id:
               self.rule_groups[algorithm_id].append(idx)

       # 2. 解析无ID的hint → 存入 operator_rule_names
       for idx, op in enumerate(self.operators):
           # ... 解析 HINT=Rule:IncrementalXxxRule (无ID) ...
           if rule_name and not algorithm_id:
               self.operator_rule_names[idx] = rule_name

       # 3. 匹配无ID的hint到算法
       self._assign_hints_without_id_to_algorithms()

   def _assign_hints_without_id_to_algorithms(self):
       for idx, rule_name in self.operator_rule_names.items():
           op_type = self._get_operator_type(self.operators[idx])

           # 向下游查找匹配的算法（同时检查算子类型和rule名称）
           matched_algorithm_id = self._find_matching_algorithm_downstream_by_name(
               idx, rule_name, op_type
           )

           if matched_algorithm_id:
               self.rule_groups[matched_algorithm_id].append(idx)

   def _find_matching_algorithm_downstream_by_name(self, start_idx, rule_name, op_type):
       # 提取基础rule名称（去除版本号）
       base_rule_name = self._extract_base_rule_name(rule_name)

       # BFS向下游搜索
       for current_idx in downstream_operators:
           for algorithm_id in self.rule_groups:
               algo_rule_name = self.algorithm_id_to_rule_name[algorithm_id]
               algo_base_name = self._extract_base_rule_name(algo_rule_name)
               algo_type = self._identify_algorithm_type(algorithm_id)

               # 检查算子类型和rule名称是否都匹配
               if algo_type == op_type and algo_base_name == base_rule_name:
                   return algorithm_id

       return None

   # ========== 阶段2：在 _identify_incremental_algorithms_with_subplan() 中完成 ==========
   def _identify_incremental_algorithms_with_subplan(self):
       sorted_rule_groups = self._sort_rule_groups_by_topology()

       # ========== 第一个循环：为所有算法构建确定集合 ==========
       all_confirmed_sets = {}

       for rule_id, rule_op_indices in sorted_rule_groups:
           algo_type = self._identify_algorithm_type(rule_id)

           # 连通所有hint算子，找到它们之间路径上的所有算子
           confirmed_set = self._connect_hint_operators_for_algorithm(
               set(rule_op_indices), algo_type, rule_id, operator_hint_map
           )

           all_confirmed_sets[rule_id] = {
               'confirmed_set': confirmed_set,
               'algo_type': algo_type,
               'rule_op_indices': rule_op_indices
           }

       # ========== 第二个循环：从确定集合扩展到完整subplan ==========
       for rule_id, rule_op_indices in sorted_rule_groups:
           algo_info = all_confirmed_sets[rule_id]
           confirmed_set = algo_info['confirmed_set']
           algo_type = algo_info['algo_type']

           # 从确定集合扩展到完整subplan（使用边界规则）
           subplan_indices = self._find_algorithm_subplan_from_confirmed_set(
               confirmed_set,
               algorithm_type=algo_type,
               current_rule_id=rule_id,
               operator_hint_map=operator_hint_map,
               assigned_operators=assigned_operators
           )

   def _connect_hint_operators_for_algorithm(self, hint_operators, algorithm_type,
                                             current_rule_id, operator_hint_map):
       """连通所有hint算子，找到它们之间路径上的所有算子"""
       confirmed_set = set(hint_operators)
       hint_list = list(hint_operators)

       # 找到所有hint算子之间的连通路径
       for i in range(len(hint_list)):
           for j in range(i + 1, len(hint_list)):
               idx1, idx2 = hint_list[i], hint_list[j]

               # 检查是否有连通路径
               if self._has_path_between(idx1, idx2, max_depth=20):
                   # 找到路径上的所有算子
                   path_operators = self._find_all_paths_between(idx1, idx2, max_depth=20)
                   confirmed_set.update(path_operators)

       return confirmed_set
   ```

   **重要性**：
   - **两阶段方法确保了准确性**：先确定哪些算子肯定属于该算法，再扩展
   - **处理无ID的hint**：通过向下游查找，将无ID的hint正确归属到对应算法
   - **连通图保证完整性**：所有hint算子之间的路径都被包含，避免遗漏
   - **边界规则控制范围**：从确定集合扩展时，边界规则防止跨算法包含

##### 增量算法识别流程

**自动识别步骤**：

1. **识别 TableScan 数据类型**（4.2.1.1）
   - 解析 `incrementalTableProperty` 的 from/to 字段
   - 标记每个 scan 是 delta 还是 snapshot

2. **解析 Rule Hints**（4.2.1.2）
   - 提取所有 Rule hint
   - **⚠️ 过滤 DeletePlan hint**：忽略所有包含 `DeletePlan` 的 Rule hint（不作为算法起点）
   - 按照 Rule ID 分组算子
   - 识别算法类型（Aggregate/Join/Window）

3. **构建算子依赖关系**（4.2.1.3）
   - 分析算子的输入输出关系
   - 构建依赖图
   - 使用 plan.json 的 "id" 字段表示每个算子的唯一 id

4. **传播数据类型**（4.2.1.1）
   - 从 TableScan 开始，按照传播规则推导每个算子的数据类型
   - 迭代直到所有算子的类型都确定

5. **识别增量算法边界**（4.2.1.2 & 4.2.1.3）
   - 根据 Rule ID 分组找到每个增量算法的所有算子
   - 区分原始 SQL 算子和算法辅助算子
   - 找到每个增量算法的 root 算子（最上层算子）

**示例**：

假设有以下 plan：
```
TableScan(delta) → Join → Aggregate(P1) → Aggregate(P2) → Aggregate(Final)
                     ↑
TableScan(snapshot) ─┘
```

分析结果：
- TableScan1: delta
- TableScan2: snapshot
- Join: delta（因为有一个输入是 delta）
- Aggregate(P1): delta（输入是 delta）
- Aggregate(P2): delta（输入是 delta）
- Aggregate(Final): delta（输入是 delta）

如果 Aggregate(P1/P2/Final) 都有 `Rule:IncrementalAggregateRule#12345`：
- 这三个 Aggregate 都是为了计算同一个 Aggregate 的增量算法
- 其中 Aggregate(Final) 是原始 SQL 的 Aggregate
- Aggregate(P1/P2) 是算法辅助算子（3阶段聚合的中间阶段）

##### 边界条件（重要）

在查找增量算法的 subplan 时，必须设置严格的边界条件以避免跨算法包含。

**⚠️ 关键区别**：不同边界条件对 subplan 的处理方式不同：
- **排除边界**：不添加到 subplan，直接返回
- **包含边界**：添加到 subplan，但终止遍历

**边界条件**：

1. **不同 hint 终止**（包含边界）：
   - 碰到不是相同 hint 的算子，必须终止（避免将其他增量算法的算子包含进来）
   - ✅ **添加到 subplan**，然后终止遍历

2. **Aggregate Final/Complete 终止**（包含边界）：
   - 对于 aggregate 算法，查找上游碰到 Final/Complete 状态也要终止（避免跨越算法边界）
   - ✅ **添加到 subplan**，然后终止遍历

3. **⚠️ DeletePlan 终止**（排除边界）：
   - 如果遇到 DeletePlan 相关算子，必须终止遍历
   - **原因**：DeletePlan 不属于任何增量算法
   - **为什么不能跳过**：由于 plan 是执行路径，如果跳过 DeletePlan 继续查找，找到的 subplan 会缺少中间算子（不完整）
   - ❌ **不添加到 subplan**，直接返回

4. **⚠️ Snapshot 边界终止**（包含边界）：
   - 向上游遍历时，如果当前算子是 snapshot 且上游也是 snapshot，必须终止遍历
   - **原因**：snapshot 表示完整状态，其上游的 snapshot 不应该再属于增量算法一部分
   - **为什么不能跳过**：由于 plan 是执行路径，如果跳过 snapshot 继续查找，找到的 subplan 会缺少中间算子（不完整）
   - ✅ **添加到 subplan**，然后终止遍历
   - **注意**：这个检查仅在向上游（输入）遍历时生效，向下游遍历不受影响

5. **⚠️ Calc 边界终止**（包含边界）：
   - 如果是 calc 有 hint，且 hint 包含了 DeltaState 和 Incremental，必须终止遍历
   - **原因**：这种 calc 算子是某个增量算法的边界
   - ✅ **添加到 subplan**，然后终止遍历

6. **⚠️ DF Aggregate 终止**（排除边界）：
   - 如果遇到 aggregate 算子，且聚集函数包括 MULTI_RANGE_COLLECT 或 _DF_BF_COLLECT，必须终止遍历
   - **原因**：这是一个 DF (Dynamic Filter) 的 aggregate，仅仅是优化的一个 plan，不需要添加
   - ❌ **不添加到 subplan**，直接返回
   - **检查的聚集函数**：MULTI_RANGE_COLLECT, _DF_BF_COLLECT, DF_BF_COLLECT, BF_COLLECT

##### 验证规则（重要）

根据 prompt 4.2.1.3 第 60 行的要求，脚本会自动验证增量算法的正确性。这些验证规则用于检测脚本实现是否正确。

**验证规则**：

1. **算子唯一性**：同一个 operator 不应该属于两个不同的增量算法
   - **例外**：root 节点或 TableScan 可以横跨多个增量算法
   - **原因**：一个算子只能属于一个增量算法的执行路径（除了共享的输入源）

2. **上下游冲突**：如果某个 operator 属于了上游的增量算法，就不应该属于下游的增量算法
   - **原因**：增量算法的执行是有顺序的，算子不应该同时参与上下游的计算
   - **例外**：TableScan 可以被多个算法共享

3. **Snapshot 边界**：对于 snapshot 的算子，增量算法遍历时应该停止
   - **原因**：snapshot 算子表示完整状态，其上游不应该再属于增量算法
   - **检查**：如果算法包含 snapshot 算子，不应该继续向上游遍历到其他 snapshot 算子

4. **DeletePlan 边界**：如果遇到 DeletePlan 算子，遍历应该已经终止
   - **原因**：DeletePlan 不属于任何增量算法，不应该出现在增量算法的 subplan 中
   - **检查**：如果增量算法的 subplan 包含 DeletePlan 算子，说明边界检测有问题

5. **Top-Down 遍历检查**（根据 original_prompt.md 第 76 行）：从 root 节点开始 top-down 遍历，在碰到边界算子前不应该有其他增量算法的算子
   - **原因**：如果在遍历路径中发现其他算法的算子，说明算法边界识别有问题
   - **检查方法**：
     - 从每个算法的 root 节点开始
     - 向下游（输入方向）遍历
     - 在遇到边界条件前，检查路径上的算子是否属于其他算法
     - 如果有，说明算法识别有问题
   - **边界条件**：与 subplan 查找时的边界条件一致（DeletePlan、不同 hint、Final/Complete、Snapshot 边界等）

**验证警告输出**：

如果检测到问题，脚本会在控制台输出验证警告：

```
[WARNING] 增量算法验证发现 4 个问题:
  ⚠️  [算子唯一性] 算子 12345 属于 2 个不同的增量算法（非 root 节点且非 TableScan）: ...
  ⚠️  [上下游冲突] 算子 67890 同时属于上游算法 IncrementalJoinRule#111 和下游算法 IncrementalAggregateRule#222
  ⚠️  [Snapshot 边界] 算法 IncrementalAggregateRule#333 包含 snapshot 算子 op_100，但继续向上游遍历到 snapshot 算子 op_50
  ⚠️  [Top-Down 遍历] 算法 IncrementalAggregateRule#444 从 root 节点遍历时，在碰到边界前发现算子 op_200 属于其他算法: IncrementalJoinRule#555
```

**重要提示**：

- ⚠️ 这些是**验证规则**，不是告警
- ⚠️ 如果不满足这些规则，说明**脚本有问题**，需要修改脚本实现
- ⚠️ 验证警告表明增量算法识别逻辑可能存在错误，需要检查：
  - `_find_algorithm_subplan_strict()` 的边界检测逻辑
  - `_validate_algorithms()` 的验证逻辑
  - 算子依赖关系的构建是否正确

**代码位置**：

验证逻辑实现在 `utils/incremental_algorithm_analyzer.py`：
- `_validate_algorithms()` 方法：主验证入口，包含规则 1-4
- `_validate_topdown_traversal()` 方法：规则 5 的实现（Top-Down 遍历检查）
- `_topdown_traverse_and_check()` 方法：递归遍历并检查算子归属
- `_is_boundary_operator()` 方法：判断边界条件

##### TableScan Append-Only 信息收集

**目的**：为每个增量算法收集所有 TableScan 算子的 append-only 信息

根据 prompt 4.2.1.3.1 新增要求：
> "每个增量算法得到了自己所有算子后，把所有tablescan算子找出来，
> 如果全部是appendonly的tablescan，则显示出来，并标注；
> 如果不全部是，也请显示每个tablescan是不是appendonly；
> appendonly信息在4.2.1.5里已经得到，从这里拿"

**实现方法**：

在 `_identify_incremental_algorithms_with_subplan()` 方法中，为每个算法添加 `tablescan_append_only_info` 字段：

```python
def _collect_tablescan_append_only_info(self, subplan_indices: List[int]) -> Dict:
    """
    收集增量算法中所有 TableScan 算子的 append-only 信息
    
    Returns:
        {
            'has_tablescans': bool,  # 是否包含 TableScan
            'all_append_only': bool,  # 是否所有 TableScan 都是 append-only
            'total_tablescans': int,  # TableScan 总数
            'delta_tablescans': int,  # Delta TableScan 数量
            'tablescans': [
                {
                    'operator_id': str,
                    'operator_index': int,
                    'data_type': str,  # 'delta' or 'snapshot'
                    'append_only_type': str,  # 'append_only', 'with_delete', 'not_applicable'
                    'is_append_only': bool
                }
            ]
        }
    """
    tablescans = []
    
    # 遍历 subplan 中的所有算子，找出 TableScan
    for idx in subplan_indices:
        if idx >= len(self.operators):
            continue
            
        op = self.operators[idx]
        
        # 检查是否是 TableScan 算子
        if 'tableScan' not in op:
            continue
        
        # 获取算子的数据类型和 append-only 类型（从 4.2.1.5 的分析结果中获取）
        data_type = self.operator_data_types.get(idx, DataType.UNKNOWN)
        append_only_type = self.operator_append_only_types.get(idx, AppendOnlyType.UNKNOWN)
        op_id = self.operator_ids.get(idx, f"op_{idx}")
        
        # 判断是否为 append-only（只有 delta 数据才有 append-only 的概念）
        is_append_only = (
            data_type == DataType.DELTA and 
            append_only_type == AppendOnlyType.APPEND_ONLY
        )
        
        tablescans.append({
            'operator_id': op_id,
            'operator_index': idx,
            'data_type': data_type.value,
            'append_only_type': append_only_type.value,
            'is_append_only': is_append_only
        })
    
    # 判断是否所有 TableScan 都是 append-only（只考虑 delta 类型的 TableScan）
    delta_tablescans = [
        ts for ts in tablescans 
        if ts['data_type'] == DataType.DELTA.value
    ]
    
    all_append_only = (
        len(delta_tablescans) > 0 and
        all(ts['is_append_only'] for ts in delta_tablescans)
    )
    
    return {
        'has_tablescans': len(tablescans) > 0,
        'all_append_only': all_append_only,
        'total_tablescans': len(tablescans),
        'delta_tablescans': len(delta_tablescans),
        'tablescans': tablescans
    }
```

**输出示例**：

```json
{
  "type": "aggregate",
  "rule_id": "IncrementalAggregateSetDeltaRuleV2#5399145",
  "tablescan_append_only_info": {
    "has_tablescans": true,
    "all_append_only": true,
    "total_tablescans": 2,
    "delta_tablescans": 1,
    "tablescans": [
      {
        "operator_id": "12345",
        "operator_index": 10,
        "data_type": "delta",
        "append_only_type": "append_only",
        "is_append_only": true
      },
      {
        "operator_id": "12346",
        "operator_index": 15,
        "data_type": "snapshot",
        "append_only_type": "not_applicable",
        "is_append_only": false
      }
    ]
  }
}
```

**显示格式**：

在增量算法分析结果中，会显示每个算法的 TableScan 信息：

```
增量算法: IncrementalAggregateSetDeltaRuleV2#5399145 (aggregate)
  算子数量: 15
  TableScan 信息:
    - 包含 TableScan: True
    - 总数: 2
    - Delta TableScan: 1
    - ✅ 所有 delta TableScan 都是 append-only (1/1)
      - TableScan#12345 (delta, append_only) ✅
    - 另有 1 个 snapshot TableScan (不参与 append-only 判断)
      - TableScan#12346 (snapshot, N/A)
```

或者如果不是全部 append-only：

```
增量算法: IncrementalJoinWithoutCondenseRule#5398716 (join)
  算子数量: 20
  TableScan 信息:
    - 包含 TableScan: True
    - 总数: 3
    - Delta TableScan: 2
    - ⚠️  部分 delta TableScan 是 append-only (1/2)
      - TableScan#12347 (delta, append_only) ✅
      - TableScan#12348 (delta, with_delete) ⚠️
    - 另有 1 个 snapshot TableScan (不参与 append-only 判断)
      - TableScan#12349 (snapshot, N/A)
```

**重要说明**：
- **只有 delta 类型的 TableScan 才有 append-only 的概念**
- snapshot 类型的 TableScan 不参与 append-only 判断
- `all_append_only` 字段表示"所有 delta TableScan 是否都是 append-only"
- 显示时会明确区分 delta 和 snapshot TableScan

**应用场景**：

这个信息可以用于：
1. **Window 优化（4.2.3）**：检查 window 输入是否全部是 append-only
2. **Aggregate 复用（4.2.6）**：检查 aggregate 输入是否全部是 append-only
3. **状态表优化（4.2.5）**：判断是否需要创建状态表
4. **增量算法分析**：了解增量算法的输入数据特性

#### 4.2.1.4 展示增量算法以及显示查看增量算法的状态信息/状态图等

**目的**：可视化增量算法的依赖关系，展示哪些算子计算 aggregate/join/window

##### 增量算法可视化

生成增量算法依赖关系图，包括：
- 每个增量算法的类型（Aggregate/Join/Window）
- 算法包含的算子列表
- 算法之间的依赖关系
- 执行顺序（从上到下）
- Root 算子标识

##### 应用场景

**状态表优化规则使用**：

**重要前提**：关于状态表这些优化必须是对应算子的对应增量算法，如 aggregate 则必须是增量算法产生的，join/window 等都类似；可以根据 4.2.1.2 来判断。

1. **aggregate_reuse 规则**：
   - 只检查原始 SQL 的 Aggregate
   - 过滤掉算法辅助的 Aggregate（P1/P2 阶段）
   - **必须检查 aggregate 是否有增量 hint**（根据 4.2.1.2）：
     - 检查是否包含 `IncrementalLinearFunctionAggregateRule` 等 Rule hint
     - 检查是否包含 `HINT=delta,DeltaState:...` 等新格式 hint
     - 如果没有增量 hint，说明不是原始 SQL 的 aggregate，跳过

2. **state_table_enable 规则**：
   - 只为原始 SQL 的算子建议状态表
   - 不为算法辅助算子建议状态表
   - **必须验证算子属于增量算法**（根据 4.2.1.2）

3. **其他规则**：
   - 类似地区分 Join/Window 的原始算子和辅助算子
   - 所有状态表优化都必须基于增量算法识别（4.2.1.2）

#### 4.2.1.5 算子 delta 是否为 append-only（纯增）

**目的**：判断 delta 数据是否为 append-only（纯增，没有删除），用于后续优化决策

**判断规则**：

1. **TableScan 算子**：
   - 检查是否输出 `__incremental_deleted` 列（注意是过去式）
   - 检查位置：算子的实际输出列（`operator.schema.structTypeInfo.fields`），而不是表定义的完整schema
   - **如果输出** → delta 不是纯增（有删除）
   - **如果没有输出** → delta 是纯增

   ```python
   # 获取算子实际输出的列
   operator_schema = op.get('schema', {})
   struct_info = operator_schema.get('structTypeInfo', {})
   fields = struct_info.get('fields', [])

   has_delete_col = any(f.get('name') == '__incremental_deleted' for f in fields)

   if has_delete_col:
       append_only_type = "with_delete"  # 有删除
   else:
       append_only_type = "append_only"  # 纯增
   ```

2. **Join 算子**：
   - **优先检查 DeltaState 模式**（新增规则）：
     - `DeltaState-` 表示有删除（非纯增）
     - `DeltaState+` 表示纯增
   - **如果没有 DeltaState 模式**，按以下逻辑：
     - **情况1**：只有一路是 delta，且 join type 是 `inner/anti/left_semi`
       - 继承该 delta 输入的 append-only 类型
     - **情况2**：所有输入都是 delta，且 join type 是 `inner/left_semi/anti`
       - **必须检查 Rule hint**：join 上必须有 Rule pattern（如 `Rule:IncrementalJoinWithoutCondenseRule`）
       - 所有 delta 都是纯增且有 Rule hint 时，join 的 delta 才是纯增
     - **其他情况**：默认为有删除

   ```python
   # 新增：优先检查 DeltaState 模式
   op_str = json.dumps(op)
   if 'DeltaState-' in op_str:
       append_only_type = "with_delete"  # 有删除
   elif 'DeltaState+' in op_str:
       append_only_type = "append_only"  # 纯增
   else:
       # 原有逻辑
       join_type = get_join_type(op)  # 从 hashJoin.join.type 路径提取
       delta_inputs = [inp for inp in inputs if inp.data_type == 'delta']

       if len(delta_inputs) == 1 and join_type in ['inner', 'anti', 'left_semi']:
           # 继承该 delta 输入的 append-only 类型
           append_only_type = delta_inputs[0].append_only_type
       elif len(delta_inputs) == len(inputs) and join_type in ['inner', 'left_semi', 'anti']:
           # 多 delta join：必须检查 Rule hint
           if all(inp.append_only_type == 'append_only' for inp in delta_inputs) and has_rule_hint(op):
               append_only_type = "append_only"
           else:
               append_only_type = "with_delete"
       else:
           append_only_type = "with_delete"
   
   def get_join_type(op):
       """从 hashJoin.join.type 路径提取 join type"""
       if 'hashJoin' in op and 'join' in op['hashJoin']:
           return op['hashJoin']['join'].get('type', 'unknown').lower()
       # 类似处理 nestedLoopJoin, broadcastHashJoin
       return 'unknown'
   
   def has_rule_hint(op):
       """检查是否有 Rule hint pattern"""
       op_str = json.dumps(op)
       return 'Rule:' in op_str
   ```

3. **Aggregate/Window 算子**：
   - **优先检查 DeltaState 模式**（新增规则）：
     - `DeltaState-` 表示有删除（非纯增）
     - `DeltaState+` 表示纯增
   - **如果没有 DeltaState 模式**：继承输入的 delta 是否纯增

   ```python
   # 新增：检查 DeltaState 模式
   op_str = json.dumps(op)
   if 'DeltaState-' in op_str:
       append_only_type = "with_delete"  # 有删除
   elif 'DeltaState+' in op_str:
       append_only_type = "append_only"  # 纯增
   else:
       # 继承输入的 append-only 类型
       # 只要有一路不是纯增，则该算子 delta 都不是纯增
       if any(inp.append_only_type == 'with_delete' for inp in inputs):
           append_only_type = "with_delete"
       else:
           append_only_type = "append_only"
   ```

   **DeltaState 模式示例**：
   ```
   HINT=delta,DeltaState-:[1,1896] - [1,6393]_IncrementalWindowSetDeltaRule#cz::optimizer::Window#44
   ```
   - `DeltaState-` 中的 `-` 表示有删除
   - `DeltaState+` 中的 `+` 表示是纯增
   - 所有 aggregate/join/window 都有类似 pattern

4. **其他算子**：
   - 把所有输入的 delta 一起看
   - 只要有一路不是纯增，则该算子 delta 都不是纯增

   ```python
   # 过滤出 delta 输入
   delta_inputs = [inp for inp in inputs if inp.data_type == 'delta']

   # 只要有一路不是纯增，则不是纯增
   if any(inp.append_only_type == 'with_delete' for inp in delta_inputs):
       append_only_type = "with_delete"
   else:
       append_only_type = "append_only"
   ```

**应用场景**：

- **4.2.3 Window 优化**：检查 window 输入是否是 append-only
- **4.2.6 Aggregate 复用**：MIN/MAX 在 append-only 情况下应该使用之前的结果

**⚠️ 新增规则总结**：

**DeltaState 模式优先级最高**：
- 对于 Join/Aggregate/Window 算子，优先检查 `DeltaState-` 或 `DeltaState+` 模式
- 如果存在 DeltaState 模式，直接根据 `+/-` 符号判断是否纯增
- 只有在没有 DeltaState 模式时，才使用原有的继承逻辑

**模式示例**：
```
HINT=delta,DeltaState-:[1,1896] - [1,6393]_IncrementalWindowSetDeltaRule#cz::optimizer::Window#44
HINT=delta,DeltaState+:[1,1896] - [1,6393]_IncrementalAggregateRule#cz::optimizer::Aggregate#123
```

**判断优先级**：
1. **DeltaState 模式** → 直接判断（最高优先级）
2. **原有逻辑** → 继承输入或检查 Rule hint（备用逻辑）

---

