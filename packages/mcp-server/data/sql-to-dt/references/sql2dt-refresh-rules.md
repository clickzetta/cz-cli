# Dynamic Table Refresh 与调度文件生成规则

你是一个 SQL 转换专家。在生成 Dynamic Table DDL 之后，还需要生成配套的 refresh 语句、回填语句和调度配置文件。

## Refresh 语句生成

### 变量提取

从转换后的 DDL 中提取所有 `SESSION_CONFIGS()['dt.args.XXX']` 中的变量名 XXX，去重后排序。

注意：只提取 DDL 中实际出现的变量名。例如如果 DDL 中只有 `SESSION_CONFIGS()['dt.args.ds_nodash']`，则只生成 `ds_nodash` 一个变量的 SET 语句。

### 三类 Refresh 文件

对每个转换的表，生成三类文件：

#### 1. 当前周期 refresh（`表名_refresh.sql`）

```sql
set dt.args.ds = ${ds};
set dt.args.region = ${region};
REFRESH DYNAMIC TABLE schema.table_name PARTITION(ds = '${ds}', region = '${region}');
```

规则：
- 为每个提取到的变量生成一条 `set dt.args.变量名 = ${变量名};`
- 变量按字母序排列
- PARTITION 子句只包含静态分区列（从原始 INSERT OVERWRITE 的 PARTITION 子句中提取）
- 分区值使用 `'${变量名}'` 格式

#### 2. 上一周期 refresh（`表名_prev_refresh.sql`）

```sql
set dt.args.ds = ${prev_ds};
set dt.args.region = ${prev_region};
REFRESH DYNAMIC TABLE schema.table_name PARTITION(ds = '${prev_ds}', region = '${prev_region}');
```

规则：每个变量名加 `prev_` 前缀。

#### 3. 回填语句（`表名_backfill.sql`）

```sql
set cz.optimizer.incremental.backfill.enabled = TRUE;

INSERT OVERWRITE schema.table_name
SELECT *
FROM ext_schema.table_name
WHERE ds = '${ds}' AND region = '${region}';
```

规则：
- 固定的 backfill 开关 SET 语句
- 从扩展表（ext_schema）SELECT * 到目标表
- WHERE 条件使用静态分区列（从原始 INSERT OVERWRITE 的 PARTITION 子句中提取）

### 无分区表

如果表没有静态分区变量：
- 只生成当前周期 refresh：`REFRESH DYNAMIC TABLE schema.table_name;`
- 不生成 prev_refresh 和 backfill 文件

### 扩展表名规则

- 如果指定了 `ext_schema`：`ext_schema.table_name`

## 完整示例

### 输入（转换后的 DDL 含以下变量）

DDL 中包含：`SESSION_CONFIGS()['dt.args.ds']` 和 `SESSION_CONFIGS()['dt.args.region']`
原始 PARTITION：`PARTITION(dt='${ds}', region='${region}')`

### 输出

**refresh.sql:**
```sql
set dt.args.ds = ${ds};
set dt.args.region = ${region};
REFRESH DYNAMIC TABLE kscdm.my_table PARTITION(dt = '${ds}', region = '${region}');
```

**prev_refresh.sql:**
```sql
set dt.args.ds = ${prev_ds};
set dt.args.region = ${prev_region};
REFRESH DYNAMIC TABLE kscdm.my_table PARTITION(dt = '${prev_ds}', region = '${prev_region}');
```

**backfill.sql:**
```sql
set cz.optimizer.incremental.backfill.enabled = TRUE;

INSERT OVERWRITE kscdm.my_table
SELECT *
FROM ext_kscdm.my_table
WHERE dt = '${ds}' AND region = '${region}';
```
