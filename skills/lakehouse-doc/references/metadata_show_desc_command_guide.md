# SHOW和DESC命令完整指南

## 引言：元数据查询在业务中的重要性

在现代数据湖仓架构中，元数据管理是数据治理和业务分析的基础。无论是数据工程师需要了解表结构、业务分析师查找可用数据源，还是系统管理员监控资源使用情况，都离不开高效的元数据查询能力。云器Lakehouse提供了完整的SHOW和DESC命令体系，帮助用户快速获取所需的元数据信息。

### 典型业务场景

**数据分析师场景**：新加入团队的分析师需要快速了解有哪些数据表可用，每个表包含什么字段，以及如何访问这些数据。

**数据工程师场景**：在ETL流程开发中，需要确认上游表的Schema变化，检查数据管道状态，以及监控作业执行情况。

**系统管理员场景**：需要监控计算集群资源使用，管理用户权限，以及优化存储和连接配置。

**业务负责人场景**：需要了解数据资产概况，评估数据共享情况，以及确保数据安全合规。

## SHOW命令完整对象类型列表

### 1. 数据对象管理

| 对象类型          | 命令语法                                                                        | 描述              | 返回信息                |
| ------------- | --------------------------------------------------------------------------- | --------------- | ------------------- |
| **TABLES**    | `SHOW TABLES [IN schema_name] [LIKE 'pattern'] [WHERE condition] [LIMIT n]` | 查看表、视图、物化视图、动态表 | 详见下方SHOW TABLES详细说明 |
| **SCHEMAS**   | `SHOW SCHEMAS [LIKE 'pattern']`                                             | 查看模式/数据库列表      | Schema名称列表          |
| **CATALOGS**  | `SHOW CATALOGS`                                                             | 查看工作空间/目录列表     | 工作空间名称、创建时间、类型      |
| **FUNCTIONS** | `SHOW FUNCTIONS [LIKE 'pattern']`                                           | 查看可用函数列表        | 函数名称、Schema、处理器     |

### 2. 存储和连接管理

| 对象类型            | 命令语法                            | 描述         | 返回信息              |
| --------------- | ------------------------------- | ---------- | ----------------- |
| **VOLUMES**     | `SHOW VOLUMES [IN schema_name]` | 查看存储卷列表    | 卷名、创建时间、外部标识、连接信息 |
| **CONNECTIONS** | `SHOW CONNECTIONS`              | 查看存储和API连接 | 连接名、类型、状态、创建时间    |

### 3. 计算和处理管理

| 对象类型          | 命令语法                                             | 描述       | 返回信息              |
| ------------- | ------------------------------------------------ | -------- | ----------------- |
| **VCLUSTERS** | `SHOW VCLUSTERS`                                 | 查看虚拟计算集群 | 集群名、类型、状态、配置信息    |
| **JOBS**      | `SHOW JOBS [LIMIT n] [IN VCLUSTER cluster_name]` | 查看作业执行历史 | 作业ID、状态、执行时间、集群信息 |
| **PIPES**     | `SHOW PIPES [IN schema_name]`                    | 查看数据管道   | 管道名、状态、配置信息       |

### 4. 权限和安全管理

| 对象类型       | 命令语法                         | 描述     | 返回信息              |
| ---------- | ---------------------------- | ------ | ----------------- |
| **USERS**  | `SHOW USERS`                 | 查看用户列表 | 用户名、默认集群、默认Schema |
| **ROLES**  | `SHOW ROLES`                 | 查看角色列表 | 角色名、注释说明          |
| **GRANTS** | `SHOW GRANTS [TO user_name]` | 查看权限授权 | 权限类型、对象、被授权者      |

### 5. 数据共享管理

| 对象类型       | 命令语法          | 描述     | 返回信息          |
| ---------- | ------------- | ------ | ------------- |
| **SHARES** | `SHOW SHARES` | 查看数据共享 | 共享名、提供方、范围、类型 |

## SHOW TABLES 详细说明

SHOW TABLES是云器Lakehouse中最复杂和最常用的元数据查询命令，支持多种过滤和查询选项。

### 完整语法

```sql
SHOW TABLES [IN schema_name] [LIKE 'pattern'] [WHERE condition] [LIMIT n]
```

### 返回字段说明

| 字段名                        | 数据类型    | 说明           | 示例值                              |
| -------------------------- | ------- | ------------ | -------------------------------- |
| **schema\_name**           | STRING  | 表所属的Schema名称 | `mcp_demo`, `information_schema` |
| **table\_name**            | STRING  | 表名           | `customer_orders`, `sales_fact`  |
| **is\_view**               | BOOLEAN | 是否为视图        | `true`, `false`                  |
| **is\_materialized\_view** | BOOLEAN | 是否为物化视图      | `true`, `false`                  |
| **is\_external**           | BOOLEAN | 是否为外部表       | `true`, `false`                  |
| **is\_dynamic**            | BOOLEAN | 是否为动态表       | `true`, `false`                  |

### 基本用法

#### 1. 查看所有表

```sql
-- 显示当前Schema中的所有表对象
SHOW TABLES;

-- 限制返回数量
SHOW TABLES LIMIT 10;
```

#### 2. 指定Schema查询

```sql
-- 查看特定Schema中的表
SHOW TABLES IN production_schema;
SHOW TABLES IN information_schema;

-- 组合Schema和限制条件
SHOW TABLES IN data_warehouse LIMIT 20;
```

#### 3. 模式匹配查询

```sql
-- 查找以特定前缀开头的表
SHOW TABLES LIKE 'fact_%';
SHOW TABLES LIKE 'dim_%';

-- 查找包含特定字符串的表
SHOW TABLES LIKE '%customer%';
SHOW TABLES LIKE '%_temp';

-- 单字符通配符
SHOW TABLES LIKE 'table_?';
```

### 高级过滤条件

#### 1. 按表类型过滤

```sql
-- 只显示普通表（排除视图）
SHOW TABLES WHERE is_view = false;

-- 只显示视图
SHOW TABLES WHERE is_view = true;

-- 只显示物化视图
SHOW TABLES WHERE is_materialized_view = true;

-- 只显示动态表
SHOW TABLES WHERE is_dynamic = true;

-- 只显示外部表
SHOW TABLES WHERE is_external = true;
```

#### 2. 组合条件查询

```sql
-- 查找非外部的普通表
SHOW TABLES WHERE is_view = false AND is_external = false;

-- 查找所有类型的视图（包括物化视图）
SHOW TABLES WHERE is_view = true OR is_materialized_view = true;

-- 在指定Schema中查找动态表
SHOW TABLES IN analytics_schema WHERE is_dynamic = true;

-- 查找内部的数据表（排除视图和外部表）
SHOW TABLES WHERE is_view = false 
  AND is_external = false 
  AND is_materialized_view = false;
```

#### 3. 复杂业务查询

```sql
-- 数据治理：查找所有需要监控的核心表
SHOW TABLES WHERE is_external = false 
  AND is_view = false 
  AND table_name NOT LIKE '%_temp%'
  AND table_name NOT LIKE '%_staging%';

-- 性能分析：查找所有可能影响性能的动态表
SHOW TABLES WHERE is_dynamic = true;

-- 架构审计：查找所有外部依赖
SHOW TABLES WHERE is_external = true;
```

### 语法限制和注意事项

#### ✅ 支持的组合

* `IN schema_name` + `WHERE condition`
* `IN schema_name` + `LIMIT n`
* `WHERE condition` + `LIMIT n`
* `LIKE pattern` (单独使用)

#### ❌ 不支持的组合

```sql
-- ❌ LIKE和WHERE不能同时使用
-- SHOW TABLES LIKE 'test%' WHERE is_dynamic=true;

-- 解决方案：使用WHERE条件中的LIKE操作
SELECT schema_name, table_name, is_dynamic 
FROM (SHOW TABLES) 
WHERE table_name LIKE 'test%' AND is_dynamic = true;
```

### 实际应用场景

#### 场景1：数据架构分析

```sql
-- 1. 了解Schema中的表分布
SHOW TABLES IN production_schema;

-- 2. 分析表类型分布
SELECT 
  CASE 
    WHEN is_view THEN 'VIEW'
    WHEN is_materialized_view THEN 'MATERIALIZED_VIEW'
    WHEN is_dynamic THEN 'DYNAMIC_TABLE'
    WHEN is_external THEN 'EXTERNAL_TABLE'
    ELSE 'REGULAR_TABLE'
  END as table_type,
  COUNT(*) as count
FROM (SHOW TABLES)
GROUP BY table_type;
```

#### 场景2：数据清理和维护

```sql
-- 查找临时表和测试表
SHOW TABLES WHERE table_name LIKE '%temp%' 
  OR table_name LIKE '%test%' 
  OR table_name LIKE '%staging%';

-- 查找可能的备份表
SHOW TABLES WHERE table_name LIKE '%_backup%' 
  OR table_name LIKE '%_bak%'
  OR table_name LIKE '%_old%';
```

#### 场景3：权限和安全审计

```sql
-- 查找所有外部数据源
SHOW TABLES WHERE is_external = true;

-- 查找需要特别关注的动态表
SHOW TABLES WHERE is_dynamic = true;

-- 按Schema分析表的分布
SELECT schema_name, COUNT(*) as table_count
FROM (SHOW TABLES)
GROUP BY schema_name
ORDER BY table_count DESC;
```

#### 场景4：开发环境管理

```sql
-- 开发环境：查找个人开发表
SHOW TABLES LIKE '%_dev_%';
SHOW TABLES LIKE 'tmp_%';

-- 生产环境：查找核心业务表
SHOW TABLES IN production 
WHERE is_view = false 
  AND is_external = false
  AND table_name LIKE 'fact_%' 
   OR table_name LIKE 'dim_%';
```

### 性能优化建议

#### 1. 使用精确过滤

```sql
-- ✅ 好的做法：使用精确条件
SHOW TABLES IN specific_schema WHERE is_dynamic = true;

-- ❌ 避免：查询所有后过滤
-- SELECT * FROM (SHOW TABLES) WHERE schema_name = 'specific_schema';
```

#### 2. 合理使用LIMIT

```sql
-- 在大型环境中总是使用LIMIT
SHOW TABLES LIMIT 50;
SHOW TABLES IN large_schema LIMIT 100;
```

#### 3. 组合查询策略

```sql
-- 第一步：快速概览
SHOW TABLES IN target_schema LIMIT 10;

-- 第二步：精确查找
SHOW TABLES IN target_schema WHERE is_dynamic = true;

-- 第三步：详细分析
SELECT table_name, is_view, is_dynamic, is_external
FROM (SHOW TABLES IN target_schema)
WHERE table_name LIKE '%customer%';
```

### 与其他命令的配合使用

```sql
-- 结合DESC命令进行深度分析
SELECT table_name FROM (SHOW TABLES WHERE is_dynamic = true);
-- 然后对每个动态表执行：DESC TABLE table_name;

-- 结合Information Schema获取更多信息
SELECT t.table_name, t.is_dynamic, i.create_time, i.row_count
FROM (SHOW TABLES WHERE is_dynamic = true) t
LEFT JOIN information_schema.tables i 
  ON t.table_name = i.table_name 
  AND t.schema_name = i.table_schema;
```

### SHOW TABLES与其他SHOW命令的功能对比

| 命令                 | 复杂度   | WHERE支持 | LIKE支持 | IN支持 | LIMIT支持 | 主要用途     |
| ------------------ | ----- | ------- | ------ | ---- | ------- | -------- |
| **SHOW TABLES**    | ⭐⭐⭐⭐⭐ | ✅ 完整支持  | ✅ 支持   | ✅ 支持 | ✅ 支持    | 表对象管理    |
| **SHOW FUNCTIONS** | ⭐⭐⭐   | ❌       | ✅ 支持   | ❌    | ✅ 支持    | 函数查找     |
| **SHOW JOBS**      | ⭐⭐⭐   | ❌       | ❌      | ✅ 支持 | ✅ 支持    | 作业监控     |
| **SHOW VCLUSTERS** | ⭐⭐    | ❌       | ❌      | ❌    | ✅ 支持    | 集群管理     |
| **SHOW SCHEMAS**   | ⭐     | ❌       | ✅ 支持   | ❌    | ✅ 支持    | Schema浏览 |

SHOW TABLES是功能最丰富的命令，提供了最全面的过滤和查询选项。

## DESC命令完整对象类型列表

### 支持的对象类型

| 对象类型           | 命令语法                                         | 返回信息             | 使用场景            |
| -------------- | -------------------------------------------- | ---------------- | --------------- |
| **TABLE**      | `DESC [TABLE] [EXTENDED] table_name`         | 列信息、数据类型、约束、表元数据 | 了解表结构、数据类型、存储格式 |
| **VCLUSTER**   | `DESC VCLUSTER [EXTENDED] vcluster_name`     | 集群配置、状态、性能参数     | 资源管理、性能调优       |
| **VOLUME**     | `DESC VOLUME [EXTENDED] volume_name`         | 存储配置、连接信息、访问权限   | 存储管理、数据访问配置     |
| **CONNECTION** | `DESC CONNECTION [EXTENDED] connection_name` | 连接配置、认证信息、状态     | 连接故障排查、配置管理     |

## 高级查询语法

### SHOW命令扩展语法

```sql
-- 条件过滤
SHOW TABLES WHERE is_view = true;
SHOW TABLES WHERE is_dynamic = true;
SHOW TABLES WHERE is_external = false;

-- 模式匹配
SHOW TABLES LIKE 'user_%';
SHOW TABLES LIKE '%_fact';

-- 指定范围
SHOW TABLES IN production_schema;
SHOW VOLUMES IN data_engineering;
SHOW JOBS IN VCLUSTER analytics_cluster;

-- 限制结果数量
SHOW JOBS LIMIT 20;
```

### DESC命令详细与简化模式

```sql
-- 基本信息
DESC TABLE orders;

-- 详细信息（包括存储、统计等）
DESC TABLE EXTENDED orders;

-- 集群详细配置
DESC VCLUSTER EXTENDED prod_cluster;
```

## 业务场景最佳实践

### 场景1：新员工数据环境了解

**业务需求**：新加入的数据分析师需要快速了解公司的数据资产

```sql
-- 1. 了解可用的数据工作空间
SHOW CATALOGS;

-- 2. 查看业务相关的Schema
SHOW SCHEMAS LIKE '%business%';
SHOW SCHEMAS LIKE '%sales%';

-- 3. 探索核心业务表
SHOW TABLES IN business_analytics WHERE is_view = false AND is_external = false;

-- 4. 了解关键表结构
DESC TABLE business_analytics.customer_orders;
DESC TABLE business_analytics.product_catalog;

-- 5. 查看可用函数
SHOW FUNCTIONS LIKE '%date%';
SHOW FUNCTIONS LIKE '%string%';
```

### 场景2：数据工程管道开发

**业务需求**：开发ETL流程，需要了解数据源和处理环境

```sql
-- 1. 检查上游数据表状态
SHOW TABLES IN raw_data WHERE table_name LIKE '%customer%';
DESC TABLE EXTENDED raw_data.customer_transactions;

-- 2. 查看可用的存储卷
SHOW VOLUMES;
DESC VOLUME data_lake_storage;

-- 3. 检查数据管道状态
SHOW PIPES IN etl_pipeline;

-- 4. 监控作业执行情况
SHOW JOBS LIMIT 10;
SHOW JOBS IN VCLUSTER etl_cluster;

-- 5. 验证目标表结构
DESC TABLE data_warehouse.dim_customer;
```

### 场景3：系统性能监控和资源管理

**业务需求**：系统管理员需要监控和优化资源使用

```sql
-- 1. 查看所有计算集群状态
SHOW VCLUSTERS;

-- 2. 检查集群详细配置
DESC VCLUSTER EXTENDED production_cluster;
DESC VCLUSTER EXTENDED analytics_cluster;

-- 3. 监控近期作业执行情况
SHOW JOBS LIMIT 50;

-- 4. 检查存储连接状态
SHOW CONNECTIONS;
DESC CONNECTION EXTENDED prod_s3_connection;

-- 5. 分析用户和权限分布
SHOW USERS;
SHOW ROLES;
SHOW GRANTS;
```

### 场景4：数据治理和合规检查

**业务需求**：数据治理团队需要审计数据访问和共享情况

```sql
-- 1. 审计所有数据共享
SHOW SHARES;

-- 2. 检查敏感数据表访问权限
SHOW GRANTS;

-- 3. 查找包含个人信息的表
SHOW TABLES LIKE '%pii%';
SHOW TABLES LIKE '%personal%';

-- 4. 验证表结构合规性
DESC TABLE EXTENDED customer_data.user_profiles;

-- 5. 检查外部数据连接
SHOW CONNECTIONS;
DESC CONNECTION EXTENDED external_api_connection;
```

### 场景5：业务分析需求探索

**业务需求**：业务分析师探索可用数据进行特定分析

```sql
-- 1. 寻找销售相关数据
SHOW TABLES LIKE '%sales%';
SHOW TABLES LIKE '%revenue%';
SHOW TABLES LIKE '%order%';

-- 2. 了解数据表详细信息
DESC TABLE sales.monthly_revenue;
DESC TABLE sales.customer_orders;

-- 3. 查找可用的分析函数
SHOW FUNCTIONS LIKE '%agg%';
SHOW FUNCTIONS LIKE '%window%';
SHOW FUNCTIONS LIKE '%statistical%';

-- 4. 检查数据更新情况
SHOW JOBS WHERE job_text LIKE '%sales%' LIMIT 10;

-- 5. 确认计算资源可用性
SHOW VCLUSTERS;
DESC VCLUSTER analytics_cluster;
```

## 性能优化和使用技巧

### 1. 查询效率优化

```sql
-- 使用LIKE模式匹配减少结果集
SHOW TABLES LIKE 'fact_%';           -- 好的做法
-- SHOW TABLES;                      -- 避免在大环境中使用

-- 使用WHERE条件精确过滤
SHOW TABLES WHERE is_external = true;
SHOW TABLES WHERE is_dynamic = true;

-- 指定Schema减少搜索范围
SHOW TABLES IN production LIMIT 50;
SHOW VOLUMES IN data_lake;

-- 组合条件提高精确度
SHOW TABLES IN analytics WHERE is_view = false AND is_external = false;
```

### 2. 分层查询策略

```sql
-- 第一步：概览查询
SHOW SCHEMAS;
SHOW VCLUSTERS;

-- 第二步：范围缩小
SHOW TABLES IN target_schema LIMIT 20;
SHOW JOBS IN VCLUSTER target_cluster LIMIT 20;

-- 第三步：精确过滤
SHOW TABLES IN target_schema WHERE is_dynamic = true;
SHOW TABLES WHERE table_name LIKE '%customer%';

-- 第四步：详细检查
DESC TABLE EXTENDED specific_table;
DESC VCLUSTER EXTENDED specific_cluster;
```

### 3. 组合查询获取完整信息

```sql
-- 获取表的完整上下文信息
SELECT current_workspace(), current_schema(), current_user();
SHOW TABLES LIKE '%customer%';
DESC TABLE customer_analytics.customer_summary;
SHOW GRANTS;
```

## 故障排查指南

### 常见问题和解决方案

| 问题类型      | 可能原因              | 解决方案                         |
| --------- | ----------------- | ---------------------------- |
| **对象不存在** | 对象名称错误或不在当前Schema | 使用`SHOW SCHEMAS`确认范围，检查对象名拼写 |
| **权限不足**  | 用户缺少相应访问权限        | 联系管理员，使用`SHOW GRANTS`检查当前权限  |
| **语法错误**  | 命令语法不正确           | 参考本文档语法说明，注意对象类型名称           |
| **结果为空**  | 指定条件过于严格或对象确实不存在  | 放宽查询条件，使用更通用的查询              |

### 调试步骤

```sql
-- 1. 确认当前上下文
SELECT current_workspace(), current_schema(), current_user(), current_vcluster();

-- 2. 检查基本权限
SHOW GRANTS;

-- 3. 验证对象存在性
SHOW SCHEMAS;
SHOW TABLES LIMIT 10;

-- 4. 测试简单查询
SHOW TABLES LIMIT 5;
```

## 结合Information Schema的深度分析

### 元数据深度挖掘

```sql
-- 使用SHOW命令快速定位
SHOW TABLES LIKE '%fact%';

-- 结合Information Schema深度分析
SELECT table_name, table_type, create_time, row_count
FROM information_schema.tables 
WHERE table_name LIKE '%fact%'
  AND table_schema = 'data_warehouse'
ORDER BY create_time DESC;

-- 分析作业执行模式
SHOW JOBS LIMIT 5;

SELECT job_creator, COUNT(*) as job_count, 
       AVG(execution_time) as avg_execution_time
FROM information_schema.job_history 
WHERE pt_date >= CURRENT_DATE - INTERVAL '7 DAYS'
GROUP BY job_creator
ORDER BY job_count DESC;
```

### 自动化监控查询

```sql
-- 集群状态监控（直接查询，不创建视图）
SELECT 
    'VCLUSTER' as resource_type,
    name as resource_name,
    state as status,
    current_vcluster_size as current_size,
    running_jobs as active_jobs
FROM (SHOW VCLUSTERS)
WHERE state != 'RUNNING';
```

## 语法限制和注意事项

### Information Schema列名规范

```sql
-- ✅ 正确的列名
SELECT table_schema, table_name, table_type, create_time, row_count
FROM information_schema.tables;

-- ❌ 错误的列名
-- SELECT schema_name, created_time FROM information_schema.tables;
```

### SHOW命令在视图中的限制

* ✅ **支持**：直接在FROM子句中使用SHOW命令
* ❌ **不支持**：创建包含SHOW命令的视图后进行查询

```sql
-- ✅ 支持的用法
SELECT name, state FROM (SHOW VCLUSTERS);

-- ❌ 不推荐的用法
-- CREATE VIEW cluster_view AS SELECT * FROM (SHOW VCLUSTERS);
-- SELECT * FROM cluster_view;  -- 查询会失败
```

### 数据类型处理

```sql
-- ✅ execution_time已经是double类型，无需转换
SELECT AVG(execution_time) FROM information_schema.job_history;

-- ❌ 不必要的类型转换
-- SELECT AVG(CAST(execution_time AS DOUBLE)) FROM information_schema.job_history;
```

## 最佳实践总结

### 1. 日常运维检查清单

**每日检查**

* `SHOW VCLUSTERS` - 检查集群状态
* `SHOW JOBS LIMIT 20` - 监控作业执行
* `SHOW CONNECTIONS` - 验证连接状态

**每周检查**

* `SHOW SHARES` - 审计数据共享
* `SHOW GRANTS` - 检查权限变更
* `SHOW USERS` - 用户管理审计

### 2. 开发环境设置

**新项目初始化**

```sql
SHOW SCHEMAS;                                    -- 确认可用Schema
SHOW TABLES IN development LIMIT 20;            -- 查看开发环境表
DESC VCLUSTER development_cluster;               -- 确认开发集群配置
SHOW FUNCTIONS LIKE '%custom%';                  -- 查找自定义函数
```

### 3. 生产环境最佳实践

**资源管理**

* 定期使用`DESC VCLUSTER EXTENDED`检查集群配置
* 通过`SHOW JOBS`监控作业执行效率
* 使用`SHOW VOLUMES`管理存储资源

**安全管理**

* 定期执行`SHOW GRANTS`进行权限审计
* 使用`SHOW USERS`和`SHOW ROLES`管理访问控制
* 通过`SHOW SHARES`监控数据共享情况

## 总结

云器Lakehouse的SHOW和DESC命令提供了完整的元数据查询能力，覆盖了从数据对象到系统资源的全方位管理需求。通过合理使用这些命令，可以显著提高数据管理效率，支持业务快速发展和数据治理要求。

**核心要点**：

* SHOW命令支持13种主要对象类型，覆盖数据、存储、计算、权限等各个方面
* SHOW TABLES是最复杂的命令，支持IN、LIKE、WHERE、LIMIT等多种语法组合
* DESC命令支持4种对象类型的详细信息查询
* 结合WHERE、LIKE、LIMIT等条件可以实现精确查询
* 支持在FROM子句中直接使用SHOW命令进行复杂查询
* Information Schema提供标准化的元数据访问接口
* 分层查询策略能够提高查询效率和准确性

**经验证的技术特性**：

* ✅ `FROM (SHOW 命令)` 语法完全支持
* ✅ Information Schema标准接口可用
* ⚠️ 避免创建包含SHOW命令的视图
* ⚠️ 注意Information Schema中的正确列名使用

通过掌握这些命令的使用方法和最佳实践，用户可以更好地管理和利用云器Lakehouse平台的强大能力，为业务创造更大价值。
