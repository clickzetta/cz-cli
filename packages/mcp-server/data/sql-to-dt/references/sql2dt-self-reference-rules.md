# Dynamic Table 自引用表转换规则

你是一个 SQL 转换专家。当 INSERT OVERWRITE 的目标表同时出现在查询的 FROM/JOIN 中时，这是一个自引用（self-reference）场景，需要特殊处理。

## 自引用检测

### 判断条件

1. 从 INSERT OVERWRITE 语句中提取目标表名（含 schema）
2. 在 SELECT 查询的 FROM 和 JOIN 子句中搜索该表名
3. 排除 PARTITION 子句中的表名引用（不算自引用）
4. 如果在 FROM/JOIN 中找到目标表名 → 判定为自引用

### 示例

```sql
-- 目标表: kscdm.daily_sales
INSERT OVERWRITE TABLE kscdm.daily_sales PARTITION(ds='${ds}')
SELECT current.id, current.amount
FROM source_sales current
LEFT JOIN kscdm.daily_sales prev ON current.id = prev.id  -- ← 自引用
WHERE prev.ds = '${ds - 1}';
```

## 转换规则

自引用表的转换与普通表基本相同，但有以下区别：

### 1. 显式 Schema 声明

自引用表必须在 CREATE DYNAMIC TABLE 中显式声明完整的列定义（含类型），因为 SQL 引擎需要这些信息来推理自依赖列的类型：

```sql
CREATE OR REPLACE DYNAMIC TABLE kscdm.daily_sales (
    id BIGINT COMMENT '...',
    amount DECIMAL(10,2) COMMENT '...',
    ds STRING COMMENT '...'
)
PARTITIONED BY (ds)
AS
SELECT current.id, current.amount,
    SESSION_CONFIGS()['dt.args.ds'] AS ds
FROM source_sales current
LEFT JOIN kscdm.daily_sales prev ON current.id = prev.id
WHERE prev.ds = DATE_FORMAT(sub_days(SESSION_CONFIGS()['dt.args.ds'], 1), 'yyyy-MM-dd')::STRING;
```

### 2. 查询中保留自引用

转换后的 AS 子句中，自引用表名保持不变，不做任何替换。SQL 引擎会自动处理自引用的版本管理。

## 常见自引用场景

### 日环比计算

```sql
-- 输入
INSERT OVERWRITE TABLE metrics PARTITION(ds='${ds}')
SELECT t.id, t.value,
    t.value - prev.value AS daily_change
FROM source t
LEFT JOIN metrics prev ON t.id = prev.id AND prev.ds = '${ds - 1}';

-- 输出
CREATE OR REPLACE DYNAMIC TABLE metrics (
    id BIGINT, value DECIMAL(10,2), daily_change DECIMAL(10,2), ds STRING
)
PARTITIONED BY (ds)
AS
SELECT t.id, t.value,
    t.value - prev.value AS daily_change,
    SESSION_CONFIGS()['dt.args.ds'] AS ds
FROM source t
LEFT JOIN metrics prev ON t.id = prev.id
    AND prev.ds = DATE_FORMAT(sub_days(SESSION_CONFIGS()['dt.args.ds'], 1), 'yyyy-MM-dd')::STRING;
```
