# Lakehouse Data Share 跨账号数据共享入门指导

## 1. 方案概述

### 1.1 什么是Data Share

Data Share是Lakehouse提供的**无复制数据共享功能**，可在同一服务区域内实现**跨账户或跨服务实例**的数据授权与使用。与传统的数据复制或导入方案不同，Data Share不需要在企业间手动搭建数据同步链路，而是通过"授权"方式直接提供对源数据的只读访问，且实时更新。

### 1.2 核心优势

* **无复制、低延迟**：无需在企业间重复存储或定期同步，数据变更可以实时传播给消费方
* **安全可控**：数据仅以"只读"形式分享，且随时可通过权限管控移除共享对象
* **易于扩展**：通过View可以灵活过滤数据列或行，实现精细化的分享控制
* **降低成本**：消费方无需为被分享的数据存储付费，仅需使用自己的计算资源处理数据

### 1.3 适用场景

* **实时共享场景**：企业A将交易日志、用户行为数据等实时共享给企业B，企业B无需数据同步即可实时查询
* **多方协作分析**：多家合作方基于同一份实时数据进行分析，减少重复存储和传输成本
* **数据提供商与消费者模式**：数据提供方将部分数据开放给合作伙伴，消费方无需承担存储成本即可获得只读数据

## 2. 工作原理

Data Share的核心工作原理是：

1. **数据保留在提供方**：数据始终存储在数据提供方的账户中
2. **共享元数据**：共享元数据和访问权限给消费方
3. **访问控制**：消费方通过受控的只读访问权限查询数据
4. **实时更新**：提供方的数据更新后，消费方立即能访问到最新数据

**数据共享流程**：

:-: ![](.topwrite/assets/image_1747735731291.png =322)

数据提供方保留完全的控制权，可以随时更新或移除共享数据。当源数据更新时，消费方可立即获取最新数据，无需额外的数据同步操作。

## 3. 使用前提条件

* 数据提供方和数据消费方均需有Lakehouse实例
* 双方需在同一服务区域内
* 数据提供方需具备"实例管理员"(instance\_admin)角色权限
* 数据共享操作需要消费方提供其服务实例名称

## 4. 实操指南：数据提供方

### 4.1 创建分享对象

数据提供方（数据所有者）需要执行以下步骤创建并配置分享对象：

#### 4.1.1 SQL方式

```sql
-- 步骤1：创建Share对象
CREATE SHARE taxi_data_share;

-- 步骤2：将表添加到Share对象中
GRANT SELECT, READ METADATA ON TABLE demo_schema.taxi_zone_lookup TO SHARE taxi_data_share;

-- 步骤3：指定接收实例
ALTER SHARE taxi_data_share ADD INSTANCE target_instance_name;
```

#### 4.1.2 Web界面方式

1. 使用具备"实例管理员"角色的账号登录Lakehouse控制台
2. 左侧导航选择"数据管理" → "数据分享"，点击"+新增分享"
3. 填写分享名称（如taxi\_data\_share），选择工作空间
4. 点击"添加"选择要分享的数据对象（如taxi\_zone\_lookup表）
5. 点击"接收实例"下的"添加"，输入消费方提供的服务实例名称
6. 点击"确定"完成创建

:-: ![](.topwrite/assets/image_1747742254855.png =699)

#### 4.1.3 针对部分数据创建视图再共享

如果只需要共享表的部分数据，可以先创建视图，然后共享视图：

```sql
-- 创建专用schema用于管理分享视图
CREATE SCHEMA share_views;

-- 创建筛选数据的视图
CREATE VIEW share_views.filtered_taxi_zones AS 
SELECT * FROM demo_schema.taxi_zone_lookup 
WHERE borough = 'Manhattan';

-- 共享视图
GRANT SELECT, READ METADATA ON VIEW share_views.filtered_taxi_zones TO SHARE taxi_data_share;
```

### 4.2 验证分享配置

创建并配置完成后，可以通过以下命令验证分享是否正确配置：

```sql
-- 查看所有Share对象
SHOW SHARES;

-- 查看特定Share的详细信息
DESC SHARE taxi_data_share;
```

示例输出：

```
share_name       provider     provider_instance    provider_workspace  scope    to_instance        kind
---------------------------------------------------------------------------------------------
taxi_data_share  provider_instance_name  source_instance_name   source_workspace    PRIVATE  target_instance_name OUTBOUND
```

## 5. 实操指南：数据消费方

数据消费方（接收方）需要执行以下步骤来访问共享数据：

### 5.1 查看可用共享

#### 5.1.1 SQL方式

```sql
-- 查看所有可见的Share
SHOW SHARES;
```

示例输出（从消费方实例查看）：

```
share_name       provider     provider_instance    provider_workspace  scope    to_instance  kind
---------------------------------------------------------------------------------
taxi_data_share  provider_instance_name  source_instance_name   source_workspace    PRIVATE             INBOUND
```

```sql
-- 查看Share对象中包含的数据对象
DESC SHARE source_instance_name.taxi_data_share;
```

#### 5.1.2 Web界面方式

1. 登录数据消费方的Lakehouse控制台
2. 左侧导航选择"数据管理" → "数据分享"
3. 切换到"分享给我"页签，即可看到所有接收到的分享

:-: ![](.topwrite/assets/image_1747742432405.png =757)

### 5.2 创建本地Schema关联共享数据

#### 5.2.1 SQL方式

```sql
-- 创建本地Schema映射到共享数据
CREATE SCHEMA shared_taxi_data FROM SHARE source_instance_name.taxi_data_share.source_schema;
```

其中：

* `shared_taxi_data`：在本地创建的schema名称（可自定义）
* `source_instance_name`：提供方的实例名称
* `taxi_data_share`：分享对象名称
* `source_schema`：提供方的源schema名称

#### 5.2.2 Web界面方式

1. 在"分享给我"页签中找到目标分享对象
2. 点击"提取"按钮
3. 在弹窗中选择"源schema"，并指定在本地创建的schema名称
4. 点击"确定"完成提取

:-: ![](.topwrite/assets/image_1747742473685.png =373)

### 5.3 使用共享数据

创建schema后，共享数据将以只读方式出现在本地schema中：

```sql
-- 查询共享表数据
SELECT * FROM shared_taxi_data.taxi_zone_lookup LIMIT 5;

-- 创建分析视图
CREATE VIEW my_analysis AS
SELECT borough, COUNT(*) as zone_count
FROM shared_taxi_data.taxi_zone_lookup
GROUP BY borough;

-- 与本地数据关联分析
SELECT t.*, z.borough, z.zone
FROM my_local_table t
JOIN shared_taxi_data.taxi_zone_lookup z ON t.location_id = z.locationid;
```

## 6. 完整案例：跨账号共享出租车区域数据

### 6.1 背景场景

A公司运营纽约市出租车服务并维护`taxi_zone_lookup`表，包含所有区域信息。B公司是一家分析公司，需要访问这些区域数据进行分析，但不需要复制数据。

### 6.2 实施步骤

#### 6.2.1 查看源表数据

首先，A公司查看要共享的表结构：

```sql
DESC TABLE EXTENDED demo_schema.taxi_zone_lookup;
```

结果显示表结构如下：

```
column_name  data_type  comment
----------------------------------
locationid   bigint     PULocationID or DOLocationID
borough      string     
zone         string     
service_zone string     
```

表中包含265行数据，记录了纽约市出租车区域信息。

#### 6.2.2 创建分享对象

A公司创建分享对象并配置：

```sql
-- 创建Share对象
CREATE SHARE taxi_data_share;

-- 添加表到Share
GRANT SELECT, READ METADATA ON TABLE demo_schema.taxi_zone_lookup TO SHARE taxi_data_share;

-- 指定B公司的实例作为接收方
ALTER SHARE taxi_data_share ADD INSTANCE target_instance_name;
```

#### 6.2.3 验证分享配置

A公司验证分享配置是否正确：

```sql
DESC SHARE taxi_data_share;
```

输出结果显示：

```
kind      name                                shared_on
-------------------------------------------------------
WORKSPACE <WS>                                2025-05-15 20:37:58.13
SCHEMA    <WS>.demo_schema                    2025-05-15 20:38:02.018
TABLE     <WS>.demo_schema.taxi_zone_lookup   2025-05-15 20:38:02.018
```

```sql
SHOW SHARES;
```

输出结果包含新创建的分享：

```
share_name       provider     provider_instance    provider_workspace  scope    to_instance        kind
--------------------------------------------------------------------------------------
taxi_data_share  provider_instance_name  source_instance_name   source_workspace    PRIVATE  target_instance_name OUTBOUND
```

#### 6.2.4 B公司访问共享数据

B公司（实例target\_instance\_name）执行以下操作使用共享数据：

```sql
-- 查看可用分享
SHOW SHARES;

-- 查看分享内容
DESC SHARE source_instance_name.taxi_data_share;

-- 创建本地Schema
CREATE SCHEMA taxi_data FROM SHARE source_instance_name.taxi_data_share.demo_schema;

-- 查询数据
SELECT borough, COUNT(*) as zone_count 
FROM taxi_data.taxi_zone_lookup 
GROUP BY borough 
ORDER BY zone_count DESC;
```

B公司可以查询结果并创建报表，无需复制数据。当A公司更新原表数据时，B公司会立即看到最新数据。

## 7. 最佳实践

### 7.1 安全性最佳实践

* **使用视图限制敏感数据**：通过视图筛选行或列，确保只共享必要数据
* **定期审计共享对象**：使用`SHOW SHARES`和`DESC SHARE`命令定期检查共享内容
* **最小权限原则**：只授予必要的权限（SELECT和READ METADATA）
* **不要分享凭证**：严禁共享管理员账号，使用Data Share进行安全的数据共享

### 7.2 性能与成本优化

* **使用筛选视图**：通过视图限制数据量，提高查询性能
* **注意时区设置**：确保提供方和消费方使用相同的时区设置，避免时间相关查询问题

## 8. 常见问题与故障排除

### 问题1：无法看到共享数据

**可能原因**：
* 权限配置错误，例如未授予 `READ METADATA` 权限。
* 实例名称输入有误。

**解决方法**：
* 提供方使用 `SHOW GRANTS TO SHARE` 命令，检查 share 中共享的对象是否同时被授予了 `SELECT` 和 `READ METADATA` 权限。
* 验证实例名称是否正确。

### 问题2：无法查询共享数据

**可能原因**：
* 缺少SELECT权限

**解决方法**：

```sql
GRANT SELECT ON TABLE <table_name> TO SHARE <share_name>;
```

## 9. 参考信息

* [数据分享](datasharing.md)
* [跨企业数据实时共享](quickstart_datashare_between_companies.md)
* [CREATE SHARE语法](create-share.md)
* [CREATE SCHEMA FROM SHARE语法](create-schema-from-share.md)

^
