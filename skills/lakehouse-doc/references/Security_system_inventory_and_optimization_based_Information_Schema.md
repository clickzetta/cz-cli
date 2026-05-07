# 云器 Lakehouse 权限体系盘点与优化最佳实践指南

## 文档信息
- **目标读者**：系统管理员、安全管理员、数据治理团

---

## 一、概述

在云器 Lakehouse 中，用户和角色是重要的数字资产。随着业务发展，权限体系可能变得复杂，出现权限冗余、角色闲置等问题。本指南将帮助您：

- ✅ 理解云器 Lakehouse 的双层权限体系
- ✅ 掌握通过 Studio Web 界面和 SQL 进行权限管理
- ✅ 区分空间级和实例级两种权限盘点视角
- ✅ 识别和清理权限冗余
- ✅ 建立持续的权限治理机制

## 二、理解云器 Lakehouse 权限体系

### 2.1 双层权限架构

云器 Lakehouse 采用**实例-空间**双层权限体系：

```
云器 Lakehouse Instance（实例）
├── 实例级资源
│   ├── Instance Users（实例用户池）
│   │   ├── 普通用户（从全局平台同步）
│   │   └── 服务用户（API/自动化使用）
│   └── Instance Roles（实例级角色）
│       ├── instance_admin（实例管理员）
│       ├── instance_sre（实例运维）
│       ├── instance_datasource_admin（数据源管理）
│       └── ...其他实例级角色
│
└── 工作空间层
    ├── Workspace A（工作空间A）
    │   ├── Workspace Users（从实例用户池授权的用户）
    │   └── Workspace Roles（空间级角色）
    │       ├── workspace_admin
    │       ├── workspace_dev
    │       └── 自定义角色
    ├── Workspace B
    │   ├── Workspace Users
    │   └── Workspace Roles
    └── Workspace C
        ├── Workspace Users
        └── Workspace Roles
```

**关键理解**：
- 用户首先存在于实例级用户池中
- 通过 `CREATE USER` 命令将实例用户添加到特定工作空间
- 实例级角色具有跨工作空间的权限
- 工作空间级角色仅在特定工作空间内有效

### 2.2 角色类型分类

| 角色类型 | 作用范围 | 分配位置 | 示例 | 说明 |
|---------|---------|---------|------|------|
| **实例级角色** | 跨所有 Workspace | 实例层面分配 | `instance_admin`<br>`system_admin`<br>`instance_sre`<br>`instance_datasource_admin` | 拥有跨工作空间的管理权限<br>在实例级别统一管理 |
| **空间级系统角色** | 单一 Workspace | 工作空间内分配 | `workspace_admin`<br>`workspace_dev`<br>`workspace_analyst`<br>`workspace_sre`<br>`workspace_user` | 系统预置，权限范围限于特定工作空间<br>每个工作空间独立管理 |
| **空间级自定义角色** | 单一 Workspace | 工作空间内创建和分配 | 用户自定义角色名 | 根据业务需求创建<br>仅在创建它的工作空间内有效 |

> **重要说明**：
> - 系统预置角色中，`workspace_admin` 和 `instance_admin` 的权限不可修改
> - 其他预置角色的权限可以根据需要进行调整
> - 目前仅支持在工作空间内创建自定义角色，不支持创建实例级自定义角色

### 2.3 用户管理流程

理解用户在云器 Lakehouse 中的流转过程：

```
1. 全局平台用户（在 accounts.yunqi.com 注册）
         ↓ 自动同步
2. 实例用户池（存在于 Lakehouse 实例中）
         ↓ CREATE USER 命令
3. 工作空间用户（被授权访问特定工作空间）
         ↓ GRANT ROLE 命令
4. 拥有角色的用户（具有实际操作权限）
```

> **重要概念**：在工作空间中执行 `CREATE USER` 实际上是将已存在于实例用户池的用户添加到当前工作空间，这就是为什么不需要指定密码的原因。

### 2.4 角色权限范围说明

> **注意**：
> - 不同角色之间的权限继承关系需要根据实际环境验证，不同版本可能有所差异
> - `system_admin` 角色即将下线，建议使用 `instance_admin` 作为实例级管理角色
> - 建议通过实际测试确认各角色的具体权限范围

## 三、🔍 关键概念：两种盘点视角（必读）

### 3.1 空间级盘点 vs 实例级盘点

| 对比维度 | 📁 空间级盘点 | 🌐 实例级盘点 |
|---------|--------------|--------------|
| **数据来源** | information_schema（已过滤） | 全局元数据（需特殊权限） |
| **SQL 过滤条件** | `WHERE workspace_id = current_workspace_id()` | 无过滤，可见所有数据 |
| **可见范围** | 仅当前工作空间 | 所有工作空间 |
| **适用场景** | 日常权限管理 | 全局安全审计 |
| **局限性** | ❌ 无法看到其他工作空间<br>❌ 可能误判权限冗余 | ❌ 需要高级权限<br>❌ 操作复杂度高 |

### 3.2 重要提示

> ⚠️ **关键区别**：
> - 使用 `information_schema` 进行的盘点都是**空间级盘点**，只能看到当前工作空间的"局部视图"
> - 要进行实例级盘点，需要通过 Studio 管理控制台或特殊权限访问全局数据
> - 判断方法：如果您的查询基于 `information_schema` 表，那么您正在进行空间级盘点

## 五、权限盘点实践步骤

### 步骤 1：明确盘点级别

```sql
-- 确认当前盘点环境和级别
SELECT 
    '当前盘点级别' as check_item,
    '空间级盘点' as level,
    current_workspace() as workspace_scope,
    '仅可见当前工作空间数据' as visibility_limit,
    '如需全局视图请使用管理控制台' as suggestion;
```

### 步骤 2：用户角色分布分析

```sql
-- 分析用户的角色分配情况（已脱敏）
SELECT 
    CASE 
        WHEN user_name LIKE 'admin%' THEN 'admin_user_' || ROW_NUMBER() OVER (ORDER BY user_name)
        WHEN user_name LIKE 'dev%' THEN 'dev_user_' || ROW_NUMBER() OVER (ORDER BY user_name)
        ELSE 'user_' || ROW_NUMBER() OVER (ORDER BY user_name)
    END as masked_user,
    role_names,
    LENGTH(role_names) - LENGTH(REPLACE(role_names, ',', '')) + 1 as role_count,
    CASE 
        WHEN role_names LIKE '%system_admin%' THEN '包含实例级角色'
        WHEN role_names LIKE '%workspace_admin%' THEN '空间管理员'
        WHEN role_names LIKE '%workspace_dev%' THEN '开发人员'
        ELSE '普通用户'
    END as user_category
FROM information_schema.users
ORDER BY role_count DESC;
```

### 步骤 3：角色使用情况分析

```sql
-- 分析角色的分配和使用情况
SELECT 
    role_name,
    CASE 
        WHEN role_name LIKE 'instance_%' THEN '实例级角色（在空间级视图中）'
        WHEN role_name = 'system_admin' THEN '实例级角色（即将下线）'
        WHEN role_name LIKE 'workspace_%' THEN '空间级-系统预置'
        ELSE '空间级-自定义'
    END as role_classification,
    CASE 
        WHEN user_names IS NULL OR user_names = '' THEN '⚠️ 未分配'
        ELSE '✅ 已分配'
    END as assignment_status,
    CASE 
        WHEN user_names IS NOT NULL THEN 
            LENGTH(user_names) - LENGTH(REPLACE(user_names, ',', '')) + 1
        ELSE 0
    END as assigned_user_count,
    comment as description
FROM information_schema.roles
ORDER BY 
    CASE WHEN user_names IS NULL THEN 0 ELSE 1 END DESC,
    role_name;
```

> **注意**：虽然 `instance_admin` 等是实例级角色，但它们也会出现在空间级的 `information_schema.roles` 视图中，这是因为这些角色在当前工作空间中有用户被授予了该角色。

### 步骤 4：权限冗余检测

```sql
-- 检测潜在的权限冗余（需验证角色间是否真的存在继承关系）
WITH permission_check AS (
    SELECT 
        CASE 
            WHEN user_name LIKE 'admin%' THEN 'admin_user'
            WHEN user_name LIKE 'dev%' THEN 'dev_user'
            ELSE 'regular_user'
        END as user_type,
        role_names,
        CASE 
            WHEN role_names LIKE '%system_admin%' 
                 AND role_names LIKE '%workspace_%'
            THEN '可能存在跨级别冗余（需验证）'
            WHEN role_names LIKE '%workspace_admin%' 
                 AND role_names LIKE '%workspace_user%'
            THEN '可能存在同级别冗余（需验证）'
            ELSE '表面无冗余'
        END as redundancy_check,
        '建议：实际测试各角色权限以确认是否真的冗余' as action_needed
    FROM information_schema.users
)
SELECT * FROM permission_check
WHERE redundancy_check != '表面无冗余';
```

### 步骤 5：生成盘点报告

```sql
-- 生成空间级权限盘点摘要
WITH summary AS (
    SELECT 
        COUNT(DISTINCT user_name) as total_users,
        COUNT(DISTINCT role_name) as total_roles,
        SUM(CASE WHEN user_names IS NOT NULL THEN 1 ELSE 0 END) as assigned_roles,
        SUM(CASE WHEN user_names IS NULL THEN 1 ELSE 0 END) as unassigned_roles
    FROM information_schema.users
    CROSS JOIN information_schema.roles
)
SELECT 
    '===== 空间级权限盘点报告 =====' as report_header,
    current_workspace() as workspace_name,
    total_users || ' 个用户' as user_summary,
    total_roles || ' 个角色（' || assigned_roles || ' 已分配，' || unassigned_roles || ' 未分配）' as role_summary,
    ROUND(assigned_roles * 100.0 / total_roles, 1) || '%' as role_utilization,
    '注意：本报告仅包含当前工作空间数据' as important_notice
FROM summary;
```

## 六、最佳实践建议

### 6.1 分级权限管理策略

#### 📁 空间级管理（日常操作）
- **频率**：每月执行
- **范围**：当前工作空间
- **重点**：
  - 清理空间内明显的角色冗余
  - 处理长期未分配的自定义角色
  - 优化空间内用户的角色组合

#### 🌐 实例级管理（定期审计）
- **频率**：每季度执行
- **范围**：所有工作空间
- **重点**：
  - 审核 system_admin 的全局分配
  - 检查跨空间的权限一致性
  - 识别跨空间的账号重复

### 6.2 权限分配决策树

```
用户需要跨工作空间管理？
├─ 是 → 考虑分配 system_admin（需实例级审批）
└─ 否 → 仅在当前工作空间分配角色
        │
        需要管理工作空间？
        ├─ 是 → 分配 workspace_admin
        └─ 否 → 需要开发权限？
                ├─ 是 → 分配 workspace_dev
                └─ 否 → 分配 workspace_user 或其他角色
```

### 6.3 避免常见误区

| 误区 | 正确做法 |
|------|----------|
| 认为用户只存在于工作空间中 | 理解用户首先存在于实例用户池，然后被添加到工作空间 |
| 仅凭空间级视图判断实例级角色冗余 | 需要实例级视图确认其全局使用情况 |
| 假设角色间一定存在继承关系 | 实际测试验证各角色的具体权限 |
| 一次性删除所有未使用角色 | 先了解角色用途，分批处理 |
| 混淆实例级和空间级角色的管理位置 | 实例级角色在实例层面管理，空间级角色在工作空间内管理 |
| 在 SQL 中使用已废弃的角色 | 使用 `instance_admin` 替代即将下线的 `system_admin` |

### 6.4 管理工具选择建议

| 管理任务 | 推荐工具 | 原因 |
|---------|---------|------|
| 日常用户授权 | Studio Web 界面 | 操作直观，不易出错 |
| 批量权限变更 | SQL 脚本 | 效率高，可重复执行 |
| 权限审计报表 | SQL 查询 + Studio | 结合使用效果最佳 |
| 实例级管理 | Studio 管理控制台 | 可视化全局视图 |
| 自动化监控 | API + SQL | 适合集成到监控系统 |

### 6.5 监控指标建议

1. **空间级指标**（可直接监控）
   - 角色使用率 = 已分配角色数 / 空间内总角色数
   - 用户平均角色数 = 总角色分配数 / 用户数
   - 自定义角色占比 = 自定义角色数 / 总角色数

2. **实例级指标**（需要全局权限）
   - system_admin 分布 = 各空间 system_admin 用户数
   - 跨空间用户重复率 = 重复用户数 / 总用户数
   - 全局角色标准化程度 = 使用系统角色的空间数 / 总空间数

## 七、自动化与持续改进

### 7.1 创建监控视图

```sql
-- 创建空间级权限监控视图
CREATE  VIEW workspace_permission_monitor AS
SELECT 
    current_date() as monitor_date,
    current_workspace() as workspace,
    '空间级监控' as monitor_level,
    COUNT(DISTINCT u.user_name) as user_count,
    COUNT(DISTINCT r.role_name) as role_count,
    SUM(CASE WHEN r.user_names IS NOT NULL THEN 1 ELSE 0 END) as active_roles,
    ROUND(
        SUM(CASE WHEN r.user_names IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / 
        COUNT(DISTINCT r.role_name), 
        1
    ) as role_usage_percentage,
    COUNT(DISTINCT CASE WHEN u.role_names LIKE '%system_admin%' THEN u.user_name END) as admin_users
FROM information_schema.users u
CROSS JOIN information_schema.roles r
GROUP BY workspace;
```

### 7.2 定期检查脚本

```sql
-- 每月执行的权限健康检查
WITH health_check AS (
    -- 检查1: 未使用的角色
    SELECT 
        'unused_roles' as check_type,
        COUNT(*) as issue_count,
        '存在未分配的角色' as description
    FROM information_schema.roles
    WHERE user_names IS NULL OR user_names = ''
    
    UNION ALL
    
    -- 检查2: 可能的权限冗余
    SELECT 
        'potential_redundancy' as check_type,
        COUNT(*) as issue_count,
        '用户可能存在角色冗余' as description
    FROM information_schema.users
    WHERE LENGTH(role_names) - LENGTH(REPLACE(role_names, ',', '')) + 1 > 2
    
    UNION ALL
    
    -- 检查3: 高权限用户
    SELECT 
        'high_privilege_users' as check_type,
        COUNT(*) as issue_count,
        '拥有admin权限的用户' as description
    FROM information_schema.users
    WHERE role_names LIKE '%admin%'
)
SELECT 
    check_type,
    issue_count,
    description,
    CASE 
        WHEN issue_count > 0 THEN '需要关注'
        ELSE '正常'
    END as status
FROM health_check
ORDER BY issue_count DESC;
```

## 八、总结与建议

### 8.1 核心要点

1. **明确盘点级别**：始终清楚您是在进行空间级还是实例级盘点
2. **理解局限性**：空间级盘点无法看到全局情况，重大决策需要实例级视角
3. **验证假设**：不要假设角色间的继承关系，需要实际验证
4. **善用工具**：优先使用 Studio Web 界面进行日常管理，SQL 用于批量操作
5. **持续优化**：建立定期审计机制，持续改进权限管理

### 8.2 行动建议

- **立即行动**：
  - 登录 Studio 查看当前权限分布
  - 使用本指南的查询语句进行首次空间级盘点
- **短期计划**：
  - 在 Studio 中设置权限变更审批流程
  - 建立月度权限审计机制
- **长期目标**：
  - 实现自动化权限监控和优化
  - 建立跨工作空间的权限标准化体系

### 8.3 获取帮助

如需进行实例级权限审计或有其他问题，请：
1. 在 Studio 中查看帮助文档
2. 联系您的云器 Lakehouse 管理员
3. 查阅云器 Lakehouse 官方文档
4. 提交技术支持工单

---

**附录：快速参考卡**

| 任务 | 空间级方法 | 实例级方法 |
|------|------------|------------|
| 查看所有用户 | Studio → 工作空间 → 用户<br>或 `SELECT * FROM information_schema.users` | Studio → 管理 → 安全 → 用户 |
| 查看所有角色 | Studio → 工作空间 → 角色<br>或 `SHOW ROLES` | Studio → 管理 → 安全 → 角色 |
| 用户授权 | Studio 界面操作<br>或 `GRANT ROLE ... TO USER ...` | Studio 管理控制台 |
| 统计角色使用率 | 本指南 SQL 查询 | Studio 报表功能 |
| 发现权限冗余 | 基于当前空间判断 | 跨空间全面分析 |
| 清理无用角色 | 仅限自定义角色 | 可全局标准化 |

***

**注意**：本文档基于Lakehouse 2025年6月的产品文档整理，建议定期查看官方文档获取最新更新。在生产环境中使用前，请务必在测试环境中验证所有操作的正确性和性能影响。

