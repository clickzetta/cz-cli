# 错误分析规范

本文档定义 Job 错误分析的规则和处理方法。

## 8. 报错分析

### 8.0 错误信息收集器

**目标**：统一从 job_profile.json 的所有 message 字段收集错误信息，去重并精炼，为后续错误分析提供基础。

#### 设计原则

1. **统一收集**：从 Job、Stage、Task 三个层级收集所有错误信息
2. **去重精炼**：可能有重复的错误信息，需要去重和精炼
3. **分类标注**：对错误信息进行分类（冲突、超时、内存等）
4. **基础服务**：为后续的具体错误分析规则（如 8.1）提供数据基础

#### 收集位置

1. **Job 级别**：`data.jobStatus.message`
2. **Stage 级别**：`data.jobSummary.stageSummary[stage_id].message`
3. **Task 级别**：`data.jobSummary.stageSummary[stage_id].taskSummary[task_id].message`

#### 错误识别

通过关键字识别错误信息：
- error, exception, failed, failure
- conflict, timeout, abort, cancel
- invalid, illegal, denied, forbidden
- out of memory, oom, overflow
- not found, unauthorized

#### 去重策略

- 使用消息内容作为去重 key
- 完全相同的消息只保留第一个
- 保留原始消息和精炼后的消息

#### 输出格式

```python
{
    'error_messages': [
        {
            'location': 'job_status' | 'stage' | 'task',
            'stage_id': 'xxx',  # 如果是 stage/task 级别
            'task_id': 'xxx',   # 如果是 task 级别
            'message': '原始消息',
            'refined_message': '精炼后的消息（截断过长内容）',
            'raw_message': '完整原始消息'
        }
    ]
}
```

#### 存储到 Context

收集的错误信息存储到 `context['error_messages']`，供后续规则使用：
- `context['error_messages']`：精炼后的错误列表
- `context['raw_error_messages']`：原始错误列表

#### Insight 输出

```
收集到 X 条错误信息（去重后 Y 条），涉及 Z 个位置。
错误类型: 冲突错误, 超时错误, ...
```

### 8.1 提交冲突报错检测

**目标**：基于 ErrorMessageCollector 收集的错误信息，检测提交冲突错误并给出重跑建议。

#### 依赖关系

此规则依赖于 ErrorMessageCollector（8.0），必须在错误收集器之后执行。

#### 检测逻辑

从 `context['error_messages']` 中查找包含以下特征的错误信息：

```
"this job has conflicts with another concurrent job which updates"
```

#### 数据来源

不直接访问 job_profile.json，而是使用 ErrorMessageCollector 收集的错误信息：

```python
error_messages = context.get('error_messages', [])
for error in error_messages:
    if 'conflicts with another concurrent job which updates' in error['message'].lower():
        # 检测到冲突
```

#### 输出结果

**Finding**:
- type: `job_conflict_error`
- severity: `high`
- title: "Job 提交冲突错误"
- description: 详细的冲突信息，包括所有发现冲突的 Stage 和 Task
- evidence: 冲突详情列表

**Recommendation**:
- type: `rerun_job`
- priority: `high`
- title: "重新运行整个 Job"
- description: 建议重新提交并运行此 Job
- action: "重新提交并运行此 Job"

**Insight**:
- category: `error_analysis`
- message: 冲突统计信息和原因说明

#### 解决方法

**唯一解决方案**：重新运行整个 Job

**原因说明**：
- 提交冲突通常发生在多个 Job 并发更新同一张表时
- 系统无法自动解决此类冲突
- 重跑可以让 Job 在新的时间点重新执行，避免冲突

#### 实现要点

1. **依赖关系**：必须在 ErrorMessageCollector 之后执行
2. **数据来源**：从 `context['error_messages']` 获取数据，不直接访问 profile
3. **优先级**：错误分析应在其他优化分析之前执行
4. **清晰性**：输出应明确指出错误发生的位置（Job Status / Stage / Task）
5. **架构优势**：
   - 解耦：冲突检测不需要知道数据结构细节
   - 复用：其他错误分析规则也可以使用收集的错误信息
   - 扩展：新增错误类型只需添加新规则，不需要重复收集逻辑

#### 代码示例

```python
class JobConflictDetection(BaseRule):
    """检测 Job 提交冲突错误"""
    
    name = "job_conflict_detection"
    category = "error_analysis"
    
    def analyze_global(self, context: Dict) -> Dict:
        # 从 context 中获取收集的错误信息
        error_messages = context.get('error_messages', [])
        
        # 查找冲突错误
        conflict_errors = []
        for error in error_messages:
            message = error.get('message', '')
            if 'conflicts with another concurrent job which updates' in message.lower():
                conflict_errors.append(error)
        
        # 生成 findings 和 recommendations
        if conflict_errors:
            # 构建详细的错误信息
            # ...
```

#### 注意事项

1. **不要过度分析**：发现冲突后，直接建议重跑，不需要深入分析冲突原因
2. **不要给其他建议**：对于冲突错误，重跑是唯一解决方案，不要给出其他优化建议
3. **检查 profile 数据**：如果 job_profile.json 为空或无效，跳过此规则
4. **大小写不敏感**：检查时使用 `.lower()` 确保不遗漏任何格式的错误信息

## 未来扩展

后续可以添加更多错误分析规则，都基于 ErrorMessageCollector 收集的错误信息：

### 8.2 内存溢出错误（OOM）
- 检测关键字：`out of memory`, `oom`
- 解决方案：增加内存配置、优化数据倾斜

### 8.3 超时错误
- 检测关键字：`timeout`
- 解决方案：增加超时时间、优化查询性能

### 8.4 权限错误
- 检测关键字：`denied`, `forbidden`, `unauthorized`
- 解决方案：检查权限配置

### 8.5 数据格式错误
- 检测关键字：`invalid`, `illegal`, `format`
- 解决方案：检查数据格式、修复数据

### 架构优势

所有错误分析规则共享同一个错误收集器：
1. **统一收集**：ErrorMessageCollector 统一收集所有错误
2. **按需分析**：各个具体规则从收集的错误中筛选自己关心的类型
3. **易于扩展**：新增错误类型只需添加新规则，不需要修改收集逻辑
4. **性能优化**：只遍历一次 profile 数据，所有规则共享结果

### 规则模板

```python
class NewErrorDetection(BaseRule):
    """检测新类型错误"""
    
    name = "new_error_detection"
    category = "error_analysis"
    
    def analyze_global(self, context: Dict) -> Dict:
        # 从 context 获取收集的错误
        error_messages = context.get('error_messages', [])
        
        # 筛选特定类型的错误
        target_errors = [
            error for error in error_messages
            if 'keyword' in error['message'].lower()
        ]
        
        # 生成 findings 和 recommendations
        # ...
```

每个错误类型应该：
1. 有明确的检测逻辑（关键字匹配）
2. 给出具体的解决方案
3. 提供足够的上下文信息
4. 按照统一的输出格式
5. 基于 ErrorMessageCollector 的结果

## 已实现的错误分析规则

### 8.1 提交冲突错误检测（JobConflictDetection）

**关键字**：`conflicts with another concurrent job which updates`

**解决方案**：重新运行整个 Job

**输出**：
- Finding: job_conflict_error
- Recommendation: rerun_job (type)

### 8.2 优化器错误检测（OptimizerErrorDetection）

**关键字**：`optimizer internal error`

**解决方案**：
1. 如果未设置 `cz.sql.playback.scratch=true`，建议设置此参数
2. 重新运行 Job 生成 playback 信息
3. 收集 playback 信息用于问题诊断

**输出**：
- Finding: optimizer_internal_error
- Recommendation: 设置 cz.sql.playback.scratch=true (parameter type)

**特殊处理**：
- 检查 settings 中是否已设置 playback 参数
- 如果已设置，不重复推荐，但提示收集 playback 信息

**代码示例**：
```python
class OptimizerErrorDetection(BaseRule):
    def analyze_global(self, context: Dict) -> Dict:
        error_messages = context.get('error_messages', [])
        optimizer_errors = [
            e for e in error_messages
            if 'optimizer internal error' in e['message'].lower()
        ]
        
        if optimizer_errors:
            settings = context.get('settings', {})
            playback_enabled = settings.get('cz.sql.playback.scratch', '').lower() == 'true'
            
            if not playback_enabled:
                # 推荐设置 playback 参数
                recommendations.append({
                    'type': 'parameter',
                    'setting': 'cz.sql.playback.scratch',
                    'value': 'true',
                    'priority': 'high',
                    'impact': 'DIAGNOSTIC',
                    'reason': '生成 playback 信息以帮助定位优化器问题'
                })
```
