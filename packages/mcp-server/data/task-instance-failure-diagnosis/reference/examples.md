# 诊断案例库

真实案例及其诊断思路，供 AI Agent 参考学习。

---

## 案例 1: 作业超时 - SDK killed

### 错误现象

```
Clickzetta sql job: xxx
Timeout after 300.0seconds, killed by sdk
```

**关键字**: `timeout`, `killed by sdk`, `300.0seconds`

**分类**: SQL > 资源错误 (RESOURCE)

---

### 诊断思路

```
Step 1: 为什么超时？
    │
    ├─→ 检查资源是否够用（整体以及 VC 都看下）
    │
    ├─ 资源不够用 → 先加资源，然后到 Step 2
    │
    └─ 资源够用 → 到 Step 2

Step 2: 这个作业应该跑多久？5分钟是个合理超时时间还是不是？
    │
    ├─→ 调用 get_task_run_stats 查看历史运行时间平均值
    │
    ├─ 5分钟不合理（SQL本身就慢）→ 看 SQL 为什么跑得慢，优化 SQL
    │
    └─ 5分钟合理 → 到 Step 3

Step 3: 5分钟超时哪儿来的？
    │
    ├─→ 执行 desc vcluster 看看 VC 上配了没
    │
    └─→ 也可能来自很老的 Python connector，用文档里的方法把超时时间加大
```

---

### 解决方案

**根因**: Python SDK 默认超时时间（300秒）不足以完成作业

**步骤**:
1. 检查 VC 资源配置：执行 `desc vcluster` 查看超时配置
2. 检查 Python connector 版本，确认是否使用了旧版本
3. 在代码中设置作业运行超时时间

**代码示例**:

```python
# 设置作业运行超时时间为 30 秒（或更长，根据实际需要调整）
my_param = {
    'hints': {
        'sdk.job.timeout': 30
    }
}

cursor.execute('YOUR_SQL_QUERY', parameters=my_param)
```

**参考文档**: https://yunqi.tech/documents/python_reference/connector

---

### 关键点

- 超时可能来自 VC 配置或 SDK 配置
- 先排查资源问题，再看超时配置
- 历史运行时间是判断超时是否合理的重要依据
- 老版本 Python connector 可能有默认超时限制
