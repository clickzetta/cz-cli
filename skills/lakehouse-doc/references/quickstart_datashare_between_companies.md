# 数据分享

## 1. 概述

### 什么是数据分享（Data Share）

数据分享是云器 Lakehouse 提供的 **无复制** 数据共享功能，可在同一服务区域内实现 **跨账户或跨服务实例** 的数据授权与使用。与传统的数据复制或导入方案不同，数据分享不需要在企业间手动搭建数据同步链路，而是通过“授权”方式直接提供对源数据的只读访问，且实时更新。

### 应用场景

* **实时共享场景**：A 企业将自身数据（例如交易日志、用户行为数据）实时共享给 B 企业，B 企业不需要做数据同步即可实时查询更新数据。
* **多方协作分析**：多家合作方基于同一份实时数据进行分析、挖掘，减少重复存储和传输成本。
* **数据提供商与数据消费者模式**：数据提供方希望将部分数据开放给合作伙伴，合作伙伴无需承担存储成本即可获得只读数据，用于自有的 BI 分析或产品集成。

### 本文案例

本文将以 **A 企业**（数据提供方）和 **B 企业**（数据接收方）为例，介绍以下操作：

1. **A 企业创建 Data Share 并分享数据**：A 企业在自身数仓中拥有Brazil\_Commercial的电商数据，希望将脱敏后的数据纳入到 Data Share 中，指定分享给 B 企业。
2. **B 企业接收并提取 Data Share 中的数据**：B 企业在自己的云器 Lakehouse 实例中，收到A企业的分享并创建对应的 schema 来提取共享数据。
3. **B 企业使用提取的数据关联 BI 应用，制作报表**：B 企业基于 Data Share 提取出来的只读数据进行分析，在 BI 工具中制作报表。
4. **A 企业写入数据，B 企业的报表实时获取数据变更**：由于 Data Share 无复制且实时，A 企业对数据所做的更新可以在 B 企业第一时间可见。

***

## 2. A 企业创建数据分享并指定企业B进行接收

以下示例中，A 企业有物流情况表rpt\_brazil\_ec，其中包含所有销售方所有产品的物流状态。B企业是A企业其中的一个销售方（seller），A企业需要向B企业提供其销售产品的物流状态，以便B企业使用这些数据做BI看板，分析和跟踪物流状态。为此，A 企业将对 rpt\_brazil\_ec进行数据过滤，创建一个仅包含B企业数据的视图 `sub_rpt_brazil_ec_05e107217c7266362fd44b75b2cd4cc4`，并将该视图分享给企业B。

### 2.1 创建视图

因物流情况表rpt\_brazil\_ec中包含所有销售方的数据，出于数据安全考虑，不可将所有数据提供给B企业。所以需要先创建一个视图，仅包含B企业的数据，并仅分享这个视图。

表rpt\_brazil\_ec中包含销售方ID字段：seller\_id，以这个字段作为过滤条件创建以下视图：

```
--为share创建独立的schema，便于后续管理和维护
CREATE SCHEMA seller_data_share;
​
--创建视图，这里假设企业B的seller_id为05e107217c7266362fd44b75b2cd4cc4
CREATE    VIEW seller_data_share.sub_rpt_brazil_ec_05e107217c7266362fd44b75b2cd4cc4 AS
SELECT    *
FROM      rpt_brazil_ec
WHERE     seller_id = '05e107217c7266362fd44b75b2cd4cc4';
```

### 2.2 创建数据共享并分享给指定企业B

#### Web 界面操作

**1）创建数据分享**

* 使用具备“实例管理员”（`instance_admin`）角色的账号登录云器 Lakehouse 控制台。
* 左侧导航选择“数据” → “数据分享”，点击“+新增分享”。

:-: ![](.topwrite/assets/image_1740388043727.png =742)

* 在弹窗中填写分享名称（如 shipping\_detail），选择待分享数据所在的工作空间。
* 注意，待分享数据需在同一个工作空间内。如果数据本身分布在多个工作空间，可以在一个工作空间内创建其他空间待分享数据的视图，以集中所有待分享数据到同一工作空间。

:-: ![](.topwrite/assets/image_1740388342928.png =438)

**2）添加要分享的数据对象**

继续在新建分享的弹窗中，点击“添加”，选择要分享的对象。如下图，在ql\_ws空间下找到上文创建的schema：seller\_data\_share，勾选其中的视图：seller\_data\_share.sub\_rpt\_brazil\_ec\_05e107217c7266362fd44b75b2cd4cc4

点击“完成”后，该视图即被纳入分享列表。

:-: ![](.topwrite/assets/image_1740388392799.png =537)

^

**3）配置接收实例**

在同一个弹窗中，点击“接收实例”下方的“添加”按钮，输入 B 企业的云器 Lakehouse “服务实例名称”（需要B企业提供，在其登陆服务实例后的首页右上方），并点击完成。

:-: ![](.topwrite/assets/image_1740388438814.png =531)

^

**4）完成数据分享创建**

完成上述所有内容填写后，点击“确定”按钮，即完成数据分享对象的创建，并指定分享给了企业B的Lakehouse服务实例。

后续还可对该数据分享进行编辑，增减需要分享的数据对象，或增减接收此数据的Lakehouse服务实例（比如需要给B企业的其他服务实例）。

**5）查看或管理分享对象**

创建完成后，可以在“数据分享” → “我分享的”列表中看到刚创建的数据分享对象。

:-: ![](.topwrite/assets/image_1740390203623.png =718)

^

#### SQL 操作

若更偏好 SQL 操作，则请使用具备 “实例管理员”（`instance_admin`）角色的账号，在 A 企业的工作空间（如 `ql_ws`）下执行以下操作：

**1) 创建 Share**

```
CREATE SHARE shipping_detail;
```

**2) 将视图纳入 Share**

```
--注意，select赋予接收者查询数据的能力，read metadata赋予接收者可见这个view对象的能力，两个权限点均需要授予。
GRANT SELECT, READ METADATA ON VIEW seller_data_share.sub_rpt_brazil_ec_05e107217c7266362fd44b75b2cd4cc4 TO SHARE shipping_detail;
```

**3) 配置分享目标实例**

```
ALTER SHARE shipping_detail ADD INSTANCE '<替换为B企业的instance_name>';
```

其中需要由 B 企业提供其Lakehouse服务实例的名称。此操作后，B 企业将立即获得share shipping\_detail的使用权，并可从其中提取view：seller\_data\_share.sub\_rpt\_brazil\_ec\_05e107217c7266362fd44b75b2cd4cc4

的只读访问权限。

> 完成以上步骤后，A 企业即已成功将过滤后的数据通过数据分享功能分享给 B 企业。

##

### 2.3 B 企业接收并提取 Data Share 中的数据

在完成 A 企业分享后，B 企业需要在自己的云器 Lakehouse 实例中“接收并提取”分享数据，才能在查询中使用到该视图对象。

#### Web 界面操作

**查看分享给我的对象**

登录 B 企业的云器 Lakehouse 控制台，使用具备“实例管理员”或“工作空间管理员”角色的账号。

左侧导航选择“数据管理” → “数据分享”，切换到“分享给我”页签，即可看到 A 企业分享过来的 shipping\_detail。

^

**提取数据**

在 shipping\_detail 卡片下方点击“提取”按钮。

弹窗中选择“源 schema”（一个数据分享中可能包含多个schema，需要指定schema进行数据提取），以及想要将共享数据落到 B 企业服务实例下的哪个工作空间及对应 schema。

注意，这里会根据填写的schema名称新建对应的schema，且该schema为只读，不可在此schema下创建其他table或view等数据对象。

完成填写后，点击“确定”按钮，系统会在 B 企业的指定工作空间中新建只读 schema，并映射到 A 企业分享的对象。

^

**完成提取后**

B 企业可以在“数据目录”或“开发”功能的“数据”页签中，看到对应的新 schema，并看到view：sub\_rpt\_brazil\_ec\_05e107217c7266362fd44b75b2cd4cc4。

可像使用本地数据对象一样，对view中的数据进行查询操作。

^

### 2.4 SQL 操作

如果使用 SQL提取share中的数据，在 B 企业的工作空间中执行以下命令：

**查看分享对象**

```SQL
SHOW SHARES;
```

可查看到 `INBOUND` 类型的，名称为shipping\_detail 的数据分享，来自 A 企业的服务实例。

**查看shipping\_detail中有哪些数据**

```
DESC SHARE shipping_detail;
```

^

**创建本地 Schema**&#x20;

```
CREATE SCHEMA b_workspace_share_schema FROM SHARE A_instance_name.shipping_detail.share_demo;
```

其中 `A_instance_name`、`share_demo` 以及源 schema 名可通过 `SHOW SHARES;` 和 `DESC SHARE share_demo;` 查询到。

`b_workspace_share_schema` 为在 B 企业工作空间中新建的只读 schema 名称，可自定义。

^

***

## 4. B 企业使用提取的数据关联 BI 应用制作报表

B 企业提取并成功创建了只读 schema 后，即可在任意兼容云器 Lakehouse 的 BI 工具或 SQL 工作台中，对 `orders_view` 进行查询或关联分析。例如：

```
SELECT 
    order_id,
    customer_id,
    order_amount,
    order_status
FROM b_workspace_share_schema.orders_view
WHERE order_status = 'COMPLETED';
```

* **关联外部数据**：可将 `orders_view` 与 B 企业内部自有数据表进行关联（`JOIN`）分析。
* **数据建模**：可在 BI 工具中将 `orders_view` 作为数据源进行数据可视化与报表制作。

此时，B 企业已经不需要关心数据是否实时同步——Data Share 保证了当 A 企业源数据更新时，B 企业查询到的就是最新的数据。

***

## 5. A 企业在 Data Share 中写入数据，B 企业报表实时查询变更

当 A 企业往 `orders_view` 对应的底层表 `orders` 插入新数据，或者更新现有订单数据时，Data Share 会自动将变更后的数据实时暴露给 B 企业。B 企业无需额外操作，即可在 SQL 查询或 BI 报表中看到最新结果。

示例：A 企业执行以下语句更新订单状态，B 企业在其已有的报表中就能立即看到状态更新后的记录。

```
-- A 企业在 workspace_a 中执行
UPDATE orders
SET order_status = 'SHIPPED'
WHERE order_id = 10001;
```

B 企业通过之前的 BI 报表或下列 SQL 查询，实时获取最新状态：

```
-- B 企业执行
SELECT 
    order_id,
    order_status
FROM b_workspace_share_schema.orders_view
WHERE order_id = 10001;
```

***

## 总结

通过以上 5 步操作，您可以在云器 Lakehouse 平台上实现类似 Snowflake Data Sharing 的实时数据共享。Data Share 最大的特点在于：

* **无复制、低延迟**：无需在企业间重复存储或定期同步，数据变更可以实时传播给消费方。
* **数据安全可控**：数据仅以“只读”形式分享，且随时可通过权限管控移除共享对象。
* **易于扩展**：通过 View 可以灵活过滤数据列或行，实现精细化的分享控制。

^
