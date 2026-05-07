# 增量计算优化完整指南

本文档是 ClickZetta 增量计算（REFRESH SQL）优化的入口文档。

---

## 概述

增量 job 任务优化分两大块：
1. **从运行的 stage/operator 算子级别优化**
2. **优化状态表**

本指南将这两大块拆分为多个独立文档，便于按需查阅和减少 token 消耗。

---

## 优化流程

```
┌─────────────────────────────────────────────────────────────┐
│                    增量计算优化流程                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  第一步：Stage/Operator 级别优化                            │
│  📄 stage-operator-optimization.md                          │
│                                                              │
│  - 判断增量 vs 全量 refresh                                 │
│  - 单 DOP Aggregate Stage 优化                              │
│  - Hash Join 优化                                           │
│  - TableSink Stage DOP 优化                                 │
│  - 最大 DOP 提示                                            │
│  - SpillingBytes 分析                                       │
│  - 主动问题发现                                             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  第二步：增量算法分析（可选，需要 --enable-state-table）    │
│  📄 incremental-algorithm-analysis.md                       │
│                                                              │
│  - 识别 operator 是 delta 还是 snapshot                     │
│  - 识别不同算子的增量算法                                   │
│  - 算子增量算法对应的 subplan                               │
│  - 展示增量算法依赖关系                                     │
│  - 判断 delta 是否为 append-only                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  第三步：状态表优化（依赖第二步的分析结果）                 │
│  📄 state-table-optimization.md                             │
│                                                              │
│  - 非增量原因诊断                                           │
│  - Window 算子 append-only 优化                             │
│  - Append-only Scan 检查                                    │
│  - 状态表启用建议                                           │
│  - Aggregate 复用检查                                       │
│  - Calc 状态优化                                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  所有步骤都要遵守：参数推荐原则                             │
│  📄 optimization-principles.md                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 文档导航

### 🚀 快速开始

**基础分析（默认启用）**：
- [Stage/Operator 级别优化](./stage-operator-optimization.md) - 从运行的 stage/operator 算子级别进行优化

**高级分析（需要明确启用）**：
- [增量算法分析](./incremental-algorithm-analysis.md) - 识别和分析增量算法
- [状态表优化](./state-table-optimization.md) - 基于增量算法的状态表优化建议

**通用原则**：
- [优化原则](./optimization-principles.md) - 参数推荐的基本原则

### 📚 详细文档

#### 1. Stage/Operator 级别优化
**文件**: [stage-operator-optimization.md](./stage-operator-optimization.md) (~309行)

**内容**：
- 4.1.1 增量 refresh vs 全量 refresh
- 4.1.2 单 DOP Aggregate Stage 优化
- 4.1.2.1 Bloom Filter 收集检测（高优先级）
- 4.1.3 Hash Join 优化
- 4.1.4 包含 TableSink 的 Stage DOP 优化
- 4.1.5 最大 DOP 提示
- 4.1.6 SpillingBytes 分析
- 4.1.7 主动问题发现

**特点**：
- ✅ 默认启用
- ✅ 独立性强，不依赖其他文档
- ✅ 规则清晰，易于理解

**适用场景**：
- 所有增量 job 的基础分析
- 快速发现性能瓶颈
- 不需要深入的增量算法分析

---

#### 2. 增量算法分析
**文件**: [incremental-algorithm-analysis.md](./incremental-algorithm-analysis.md) (~914行)

**内容**：
- 4.2.1.1 识别所有 operator 是 delta 还是 snapshot
- 4.2.1.2 识别不同算子的增量算法
- 4.2.1.3 算子增量算法对应的 subplan
- 4.2.1.4 展示增量算法依赖关系
- 4.2.1.5 算子 delta 是否为 append-only

**特点**：
- ⚠️ 默认禁用，需要明确启用
- 🔧 最复杂的部分，包含大量算法识别逻辑
- 🎯 为状态表优化提供基础

**启用方式**：
```bash
# 命令行参数
cz-analyze-job plan.json job_profile.json --enable-state-table

# Claude Skill
"分析这两个文件的性能问题，包括状态表优化"
```

**适用场景**：
- 需要深入理解增量算法的执行过程
- 为状态表优化提供数据支持
- 调试增量计算相关问题

---

#### 3. 状态表优化
**文件**: [state-table-optimization.md](./state-table-optimization.md) (~945行)

**内容**：
- 4.2.2 非增量原因诊断
- 4.2.3 Window 算子在 append-only delta 输入时的优化
- 4.2.4 Append-only Scan 检查
- 4.2.5 状态表启用建议
- 4.2.6 Aggregate 复用检查
- 4.2.7 Calc 状态优化

**特点**：
- ⚠️ 默认禁用，需要明确启用
- 📊 依赖增量算法分析（文档2）的结果
- 💡 提供具体的状态表优化建议

**前置依赖**：
- 必须先完成增量算法分析（文档2）
- 需要 operator 的 delta/snapshot 信息
- 需要 append-only 判断结果

**适用场景**：
- 增量计算性能不理想
- 需要优化状态表存储
- 需要减少重复计算

---

#### 4. 优化原则
**文件**: [optimization-principles.md](./optimization-principles.md) (~36行)

**内容**：
- ❌ 禁止行为
- ✅ 必须做到的事项
- 📋 其他可能有用的参数处理方式

**特点**：
- 🌟 适用于所有优化规则
- 📏 定义参数推荐的基本原则
- 🎯 确保建议的准确性和可靠性

**核心原则**：
1. 仅在发现实际问题时才建议参数
2. 每个建议必须有明确的触发条件
3. 每个建议必须引用实际数据作为证据
4. 必须检查 settings 避免重复建议

---

## 使用指南

### 场景1：基础性能分析

**需要的文档**：
- ✅ stage-operator-optimization.md

**分析内容**：
- Stage 和 Operator 级别的性能瓶颈
- DOP、Join、Aggregate 等基础优化
- Spilling 分析

**命令**：
```bash
cz-analyze-job plan.json job_profile.json
```

---

### 场景2：增量算法深度分析

**需要的文档**：
- ✅ stage-operator-optimization.md
- ✅ incremental-algorithm-analysis.md

**分析内容**：
- 基础性能分析（场景1）
- 增量算法识别
- Delta/Snapshot 传播分析
- Append-only 判断

**命令**：
```bash
cz-analyze-job plan.json job_profile.json --enable-state-table
```

---

### 场景3：完整的增量优化分析

**需要的文档**：
- ✅ stage-operator-optimization.md
- ✅ incremental-algorithm-analysis.md
- ✅ state-table-optimization.md
- ✅ optimization-principles.md

**分析内容**：
- 基础性能分析（场景1）
- 增量算法分析（场景2）
- 状态表优化建议
- Window/Aggregate/Calc 优化

**命令**：
```bash
cz-analyze-job plan.json job_profile.json --enable-state-table
```

**Claude Skill**：
```
分析这两个文件的性能问题，包括状态表优化
```

---

## 文档依赖关系

```
optimization-principles.md (通用原则)
         ↓
         ├─→ stage-operator-optimization.md (独立)
         │
         └─→ incremental-algorithm-analysis.md
                      ↓
             state-table-optimization.md
```

**说明**：
- `stage-operator-optimization.md` 是独立的，不依赖其他文档
- `state-table-optimization.md` 依赖 `incremental-algorithm-analysis.md` 的分析结果
- 所有文档都要遵守 `optimization-principles.md` 的原则

---

## 维护指南

### 更新规则

1. **修改某个优化规则**：
   - 只需要更新对应的文档
   - 保持章节编号（4.1.x, 4.2.x）一致

2. **添加新的优化规则**：
   - 根据规则类型选择合适的文档
   - Stage/Operator 级别 → `stage-operator-optimization.md`
   - 增量算法相关 → `incremental-algorithm-analysis.md`
   - 状态表相关 → `state-table-optimization.md`

3. **更新文档引用**：
   - 确保文档之间的引用链接正确
   - 更新本入口文档的内容索引

### 版本历史

- **2024-01**: 原始单一文档创建（2156行）
- **2024-01-29**: 拆分为4个独立文档，创建入口文档

---

## 其他参考文档

- [original_prompt.md](./original_prompt.md) - 原始需求文档
- [core-specification.md](./core-specification.md) - 核心规范
- [data-extraction-paths.md](./data-extraction-paths.md) - 数据提取路径
- [skill_architecture.md](./skill_architecture.md) - Skill 架构说明

---

## 快速链接

| 文档 | 行数 | 启用方式 | 依赖 |
|------|------|----------|------|
| [stage-operator-optimization.md](./stage-operator-optimization.md) | ~309 | 默认启用 | 无 |
| [incremental-algorithm-analysis.md](./incremental-algorithm-analysis.md) | ~914 | 需要 `--enable-state-table` | 无 |
| [state-table-optimization.md](./state-table-optimization.md) | ~945 | 需要 `--enable-state-table` | 文档2 |
| [optimization-principles.md](./optimization-principles.md) | ~36 | 总是适用 | 无 |

---

## 总结

本指南将原始的 2156 行文档拆分为 4 个独立文档，每个文档专注于一个特定的优化维度：

1. **Stage/Operator 优化** - 基础性能分析（默认启用）
2. **增量算法分析** - 深度算法识别（可选）
3. **状态表优化** - 状态表优化建议（可选，依赖文档2）
4. **优化原则** - 通用参数推荐原则（总是适用）

这种结构既保持了完整性，又提供了灵活性，可以根据实际需求选择性加载文档，有效减少 token 消耗。
