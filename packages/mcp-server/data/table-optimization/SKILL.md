---
name: table-optimization
description: |
  Clickzetta 表优化与治理工具。使用场景：分析表的小文件问题、检查 Compaction 配置、识别废弃表、优化表生命周期，并给出优化建议。触发词：小文件、compaction 配置检查、废弃表分析、文件分布诊断、分区优化建议、data_lifecycle、表治理建议。禁止触发场景：用户明确要求“直接执行 SQL”（例如 `OPTIMIZE schema.table`、`OPTIMIZE sql帮我手动执行一下`）时，不调用本 skill，应改用 SQL 执行工具。重要：该优化必须通过 scripts/table_optimizer.py 脚本来生成辅助分析的代码。
---

# Table Optimization Skill

## ⚠️ 严格约束（必须遵守）

**禁止自己编写或推理 SQL**。所有 SQL 必须通过脚本生成：
调用 `execute_skill_script` 执行（仅允许 scripts/* 或 bin/*）。
```bash
# 运行脚本生成 SQL
python scripts/table_optimizer.py <action> --table <table_name>
```

脚本输出 JSON，从中获取 `diagnostic_sql` 或 `optimization_sql` 字段执行。

❌ 错误：`LH_execute_query(sql="SHOW PARTITIONS xxx")`  
✅ 正确：先运行脚本，再执行脚本输出的 SQL

**禁止误用本 skill 执行用户给定 SQL**：
- 用户请求是“帮我执行 `OPTIMIZE schema.table` / 直接执行某条 SQL”时，本 skill 不应被触发
- 该请求应路由到 SQL 执行工具，而不是表治理诊断流程

---

## 可用 scripts 参数

| 脚本参数                                       | 用途 |
|--------------------------------------------|------|
| `check_abandoned --table <name> --days 30` | 检查废弃表 |
| `check_write_history --table <name>`       | 检查写入历史 |
| `get_table_properties --table <name>`      | 获取表属性（含 Compaction 配置） |
| `check_files --table <name>`               | 检查非分区表文件数量 |
| `check_partitions --table <name>`          | 检查分区表文件分布 |
| `optimize --table <name> --type <type>`    | 生成优化 SQL |

---

## Compaction 优化流程

### Step 1: 获取表属性

```bash
python scripts/table_optimizer.py get_table_properties --table schema.table_name
```

从输出判断：
- `# Partition Information` 存在 → 分区表
- `properties` 字段 → 现有 Compaction 配置
- `statistics` 字段 → 表大小（byte）

### Step 2: 根据表类型诊断

**非分区表**：
```bash
python scripts/table_optimizer.py check_files --table schema.table_name
```

**分区表**：
```bash
python scripts/table_optimizer.py check_partitions --table schema.table_name
```

**小文件问题判断标准**（参考值，非硬性阈值）：

| 指标 | 参考值 | 说明 |
|-----|-------|------|
| 平均文件大小 | ~768MB | 低于此值可能存在小文件问题 |
| 文件数量 | ~10 个 | 高于此值且平均文件较小时需关注 |

**判断逻辑**：
- ✅ 明显需要优化：平均文件大小 << 768MB **且** 文件数量 >> 10
- ⚠️ 边界情况：接近参考值时（如 700MB、12 个文件），可灵活判断
- ❌ 无需优化：平均文件大小接近或超过 768MB，或文件数量较少

**示例**：
- 表大小 5GB，文件数 100 → 平均 50MB → ✅ 明显需要优化
- 表大小 8GB，文件数 12 → 平均 ~670MB → ⚠️ 边界情况，可观察
- 表大小 1GB，文件数 5 → 平均 200MB，文件数少 → ❌ 不需优化
- 表大小 100GB，文件数 50 → 平均 2GB → ❌ 平均文件大小足够

### Step 3: 生成优化 SQL（如需优化）

⚠️ **参数配置原则**：
- 先从 Step 1 的 `properties` 字段获取当前配置值
- 如果**没有配置**：使用默认值（`min-interval=1800`，`partition-window=3600`）
- 如果**已有配置但需要调小**：在当前值基础上调整（如当前 3600 → 调整为 1800）
- **不要覆盖用户已有的合理配置**

**非分区表**（DML 模式）：
```bash
# 默认值（无现有配置时）
python scripts/table_optimizer.py optimize --table schema.table_name --type compaction_daily --min-interval 1800

# 如果当前 cz.compaction.min.interval=3600，需要调小
python scripts/table_optimizer.py optimize --table schema.table_name --type compaction_daily --min-interval 1800
```

**分区表**（DML + Background 模式）：
```bash
# 默认值（无现有配置时）
python scripts/table_optimizer.py optimize --table schema.table_name --type compaction_hourly --min-interval 1800 --partition-window 3600

# 根据现有配置调整示例：
# - 当前 min.interval=3600 → 调整为 1800
# - 当前 partition.window=7200 → 调整为 3600
python scripts/table_optimizer.py optimize --table schema.table_name --type compaction_hourly --min-interval 1800 --partition-window 3600
```

**参数调整决策表**：

| 当前配置 | 小文件问题 | 建议操作 |
|---------|-----------|---------|
| 无配置 | 有 | 使用默认值：`min-interval=1800`, `partition-window=3600` |
| `min.interval=3600` | 有 | 调小为 `1800` |
| `min.interval=1800` | 有 | 保持不变，建议手动触发 OPTIMIZE |
| `partition.window=7200` | 有 | 调小为 `3600` |
| `partition.window=3600` | 有 | 保持不变，建议手动触发 OPTIMIZE |
| 配置合理 | 无 | 无需优化 |

---

## Compaction 策略说明

| 模式 | 配置值 | 含义 |
|-----|-------|------|
| DML | `cz.compaction.strategy=dml` | DML 触发，间隔由 `min.interval` 控制 |
| Background | `cz.compaction.strategy=background` | 后台自动，忽略窗口由 `ignore.latest.partition.window` 控制 |
| DML+Background | `cz.compaction.strategy=dml\|background` | 同时启用 |

**默认**：未配置时使用 Background 模式。

---

## 注意事项

1. **所有 SQL 必须由脚本生成** - 禁止自己编写
2. **ALTER TABLE 需用户确认** - 不要自动执行
3. **手动触发 Compaction 只能建议** - 命令是 `OPTIMIZE schema.table_name`，不要自动执行
4. **表名格式** - 必须使用 `schema.table` 两段式命名
5. **小文件判断标准** - 参考值（非硬性阈值）：平均文件大小 ~768MB，文件数量 ~10，接近标准也可接受
6. **参数配置智能化** - 必须先获取当前配置，根据现有值决定新配置：
   - 无配置 → 使用默认值
   - 有配置但需调整 → 在当前值基础上调小
   - 配置已经很小 → 保持不变，建议手动 OPTIMIZE
