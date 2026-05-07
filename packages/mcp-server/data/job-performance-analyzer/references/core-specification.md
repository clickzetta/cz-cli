# Job 性能分析核心规范

本文档定义 Job 性能分析的核心流程和原则。

## 1. 输入说明

**输入文件**：
- `plan.json` - **必需**，执行计划（DAG、Operator、算法类型）
- `job_profile.json` - **可选**，运行时统计（耗时、数据量、DOP）

**关键原则**：
- 完整分析需要两者结合
- 仅从 profile 无法判断算法（如 Join 类型）
- 仅从 plan 无法获取实际性能
- **当 job_profile.json 为空或不提供时**：
  - 部分分析（如增量状态表优化）仍可基于 plan.json 给出结果
  - 涉及运行时性能数据的分析将无法执行
  - 建议提供完整文件以获得最佳诊断效果

## 2. 初始化步骤

### 2.1 SQL 分类
```python
sql_text = plan['settings']['cz.sql.text']
is_refresh = 'REFRESH' in sql_text.upper()
```

### 2.2 版本信息
```python
version = plan['build_info']['GitBranch']
# ⚠️ 内部使用，不暴露给用户
```

### 2.3 VC 模式
```python
is_ap = plan['settings']['cz.inner.is.ap.vc'] == '1'
# 0 = GP, 1 = AP

# 获取 VC core 数
if is_ap:
    vc_cores = int(plan['settings']['cz.analyze.instance.executor.count'])
else:
    vc_cores = int(plan['settings']['cz.sql.gp.vc.capability']) // 100
```

### 2.4 已有参数
```python
settings = plan['settings']
# ✅ 推荐前必须检查参数是否已存在
# ❌ 不要推荐已存在且正确的参数
```

### 2.5 Stage 对齐
```python
for stage_id in plan['dml']['stages']:
    if stage_id in profile['stageSummary']:
        # 对齐成功
```

### 2.6 Operator 统计
计算每个 operator：
- 最大/平均耗时
- Stage 占比
- 总体占比
- 倾斜比率（max/avg）

### 2.7 选择分析策略

根据 SQL 类型选择：
- REFRESH → 错误分析（8） + 增量计算优化（4.1 + 4.2）
- Compaction → TODO
- GP job → TODO
- AP job → TODO

## 3. 核心原则

### ❌ 禁止行为
1. 不给无依据的参数
2. 不凭空编造 flag
3. 不推荐已存在且正确的参数
4. 不说"没有发现问题"

### ✅ 必须做到
1. 每个建议必须有明确触发条件
2. 每个建议必须有数据证据
3. 推荐前必须检查参数是否已存在
4. 必须主动分析所有慢 Stage

## 4. 参数推荐逻辑

```python
def should_recommend(param_name, expected_value):
    if param_name not in settings:
        return True  # 参数不存在，推荐
    
    if settings[param_name] != expected_value:
        return True  # 参数存在但值不对，推荐
    
    return False  # 参数已正确配置，不推荐
```

## 5. 输出格式

### 必须包含
- 发现的问题（附数据证据）
- 参数建议（仅当问题存在）
- 推理过程（引用实际数据）

### 不要包含
- 已配置的参数
- 无依据的建议
- 版本信息
- 过度解释

## 6. 工作流总结

```
输入 plan.json + job_profile.json
  ↓
初始化（2.1-2.7）
  ↓
选择策略
  ↓ (REFRESH SQL)
8. 错误分析（Job 冲突检测等）
  ↓
4.1 Stage/Operator 优化（8个子规则）
  ↓
4.2 状态表优化（7个子规则）
  ↓
生成报告（仅包含有依据的建议）
```
