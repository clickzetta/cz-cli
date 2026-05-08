# SQL → Dynamic Table 完整转换工作流

当用户给你一组 CREATE TABLE DDL 和 INSERT OVERWRITE SQL，要求转换为 Dynamic Table 时，按以下步骤顺序执行。

每一步的详细规则在对应的 skill 文件中，你需要同时引用它们。

## 工作流步骤

### Step 1: 预处理输入

从 INSERT OVERWRITE 文件中移除：
- 所有 `ALTER TABLE` 语句
- `ANALYZE TABLE` 语句
- SQL 注释（`--` 和 `/* */`）

保留：CREATE TABLE、INSERT OVERWRITE、WITH、SET、CREATE TEMPORARY FUNCTION。

### Step 2: 占位符替换

按 `sql2dt-placeholder-rules.md` 中的规则：
1. 统一占位符格式（`{{ }}` → `${ }`）
2. 替换所有占位符为 `SESSION_CONFIGS()` 调用
3. 处理 nodash 变量、日期运算、macros 函数
4. 根据引号上下文决定处理方式（去引号 / CONCAT / 直接替换）

### Step 3: 自引用检测

按 `sql2dt-self-reference-rules.md` 中的规则：
1. 检查 INSERT OVERWRITE 目标表是否出现在 FROM/JOIN 中
2. 如果是自引用表，标记并在后续步骤中添加注释、使用显式 schema

### Step 4: 核心转换

按 `sql2dt-conversion-rules.md` 中的规则：
1. 解析 CREATE TABLE DDL（提取列、分区、属性等）
2. 解析 INSERT OVERWRITE（提取查询、分区类型）
3. 组装 `CREATE OR REPLACE DYNAMIC TABLE ... AS SELECT ...`
4. 注入静态分区值到 SELECT（智能引号处理）
5. 合并表属性模板（默认 `data_lifecycle=15`）
6. 处理 UNION ALL（每个分支独立注入）
7. 日期函数后处理：将所有 `DATE_SUB/DATE_ADD` 统一转为 `sub_days`

### Step 5: 列校验

按 `sql2dt-column-validation-rules.md` 中的规则：
1. 计算 schema 列数和 SELECT 列数
2. 验证两者相等
3. 检查重复别名和缺失分区列
4. UNION ALL 分支列数一致性检查

### Step 6: 生成配套文件

按 `sql2dt-refresh-rules.md` 中的规则：
1. 从 DDL 中提取所有 SESSION_CONFIGS 变量
2. 生成当前周期 refresh 语句
3. 生成上一周期 prev_refresh 语句
4. 生成回填 backfill 语句

## 输出清单

对每个表，最终输出：

| 文件 | 内容 | 条件 |
|------|------|------|
| `表名.sql` | Dynamic Table DDL | 始终生成 |
| `表名_refresh.sql` | 当前周期 REFRESH 语句 | 始终生成 |
| `表名_prev_refresh.sql` | 上一周期 REFRESH 语句 | 仅有分区变量时 |
| `表名_backfill.sql` | 回填语句 | 仅有分区变量时 |

## 快速判断路径

```
输入 DDL + INSERT OVERWRITE
  │
  ├─ 有占位符？ → Step 2 占位符替换
  │
  ├─ 自引用？ → Step 3 特殊处理
  │
  ├─ 有静态分区？ → Step 4 注入分区值到 SELECT
  │
  ├─ 有 UNION ALL？ → Step 4 每个分支独立注入
  │
  └─ 生成 DDL → Step 5 校验 → Step 6 生成配套文件
```
