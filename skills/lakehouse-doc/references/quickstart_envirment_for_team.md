# 为团队快速搭建 Lakehouse 数据开发环境

## 概述

本文档旨在帮助您在最短时间内搭建一套可供团队共同使用的 Lakehouse 数据开发环境，环境中包括多个可登录并进行数据开发的用户身份，不同用户身份被授予不同的数据权限和角色，以保证必要的权限管控、资源配置和协作便利性。

:-: ![](.topwrite/assets/lakehouse-data-sharing-new.svg =721)

## 1. 准备工作

1. **开通云器账号**

   如果您还没有云器账号，可以前往 [云器官网](https://www.yunqi.tech/) 注册获取。开通注册方式可参考[开通使用](setup.md)。

2. **创建Lakehouse服务实例**

   您需要至少已创建一个Lakehouse服务实例。如还未开通服务实例，可参考：[开通使用](setup.md)中的“创建Lakehouse服务实例”说明进行操作。

3. **拥有 Lakehouse服务实例的instance\_admin(实例管理员) 角色**

   Lakehouse 的权限管理是基于角色（Role）的，创建Lakehouse服务实例的用户会默认具备该服务实例的instance\_admin（实例管理员）角色。

## 2. 搭建完成后

按照后续章节完成环境搭建后，您将得到以下环境：

1. 一个Lakehouse服务实例下的独立工作空间；
2. 多个可用的用户身份，并具备在工作空间下进行数据开发的权限；
3. 一个SQL任务，并可提交为周期运行。

***

## 3. 操作步骤

### 3.1 创建用户

注册云器账户时，会默认创建该账户下的第一个用户，并具备账户下所有的操作权限。当团队中多人共同使用Lakehouse进行开发时，使用多个用户身份并区分权限，可以有效对数据和资源进行管理，增强安全性、降低操作冲突的风险，并能有效审计和追溯个人操作。

为达到上述管理目的，需要为每个开发人员或每个集成服务创建独立的用户，以便为后续分配相应角色做准备。

使用注册云器账户时的默认用户[登录](https://accounts.clickzetta.com/login)云器产品，进入管理中心页面，并切换至“用户管理”功能：

:-: ![](.topwrite/assets/quickstart_team_p1.png =801)

^

点击右上角的“新建”按钮，选择“新建用户”，这里分别创建2个用户：developer 和 analyst，如下所示：

:-: ![](.topwrite/assets/quickstart_team_p2.png =361)

^

:-: ![](.topwrite/assets/quickstart_team_p3.png =360)

创建成功后，可以在用户管理的用户列表中看到这两个用户。

### 3.2 创建工作空间

在Lakehouse中，工作空间用于隔离计算资源和数据，形成相对独立的数据开发环境，避免资源冲突或误操作数据。开通Lakehouse服务实例后，系统会默认创建一个名为quickstart的工作空间（workspace）。这里为了完整介绍团队使用方式，我们创建另外一个工作空间：dev\_envirment：

仍然使用注册账户时创建的用户登录，并在管理中心点击已开通的服务实例名称，进入服务实例首页。

:-: ![](.topwrite/assets/quickstart_team_p4.png =797)

^

在服务实例首页中，依次点击左侧菜单中的“管理”-”工作空间“，进入工作空间管理页面。点击右上角的”+ 新建空间“按钮：

:-: ![](.topwrite/assets/quickstart_team_p5.png =774)

^

在弹窗中输入工作空间的名称，点击“确定”，完成工作空间创建：

:-: ![](.topwrite/assets/quickstart_team_p6.png =382)

^

:-: ![](.topwrite/assets/quickstart_team_p7.png =733)

^

### 3.4 创建schema和table

在 Lakehouse 的工作空间中，schema 用于进一步归类数据表和视图。可根据团队规模和业务需求规划 schema 层级。以下先创建3个schema：STG、CORE和ADS。

首先在新创建的dev\_envirment工作空间的右侧点击“开发”，进入开发页面，并执行以下SQL，创建schema：

:-: ![](.topwrite/assets/quickstart_team_p8.png =730)

^

:-: ![](.topwrite/assets/quickstart_team_p9.png =736)

在Schema STG中创建2张表，并插入部分样例数据：

```SQL
CREATE SCHEMA STG;   -- 数据源原始或暂存表存放
CREATE SCHEMA CORE;  -- 核心事实表/维度表存放
CREATE SCHEMA ADS;   -- 汇总或分析结果表存放


----------------------------------------------------------
-- 1. 在STG层创建示例表: EMPLOYEES
----------------------------------------------------------
CREATE TABLE STG.EMPLOYEES (
    EMP_ID          INT,
    EMP_NAME        VARCHAR(50),
    DEPARTMENT      VARCHAR(50),
    JOIN_DATE       STRING
);

-- 向表中插入一些示例数据
INSERT INTO STG.EMPLOYEES (EMP_ID, EMP_NAME, DEPARTMENT, JOIN_DATE) VALUES
    (101, 'Alice',    'Engineering', '2023-07-10'),
    (102, 'Bob',      'Sales',       '2024-08-05'),
    (103, 'Charlie',  'Finance',     '2024-09-01');

----------------------------------------------------------
-- 2. 创建示例视图: EMPLOYEES_OVERVIEW
----------------------------------------------------------
CREATE VIEW ADS.EMPLOYEES_OVERVIEW AS
SELECT 
    EMP_ID,
    EMP_NAME,
    DEPARTMENT,
    JOIN_DATE
FROM EMPLOYEES;
```

### 3.5 将团队成员加入工作空间并授权

上文中创建的两个用户：developer 和 analyst，默认并不具备任何数据操作和资源使用的权限。需要经由具备工作空间管理员角色（workspace\_admin）的用户授权后，才可以进行操作。

假设我们希望这两个用户各自的权限范围是：

**developer用户**，可以使用“开发”功能；可以在dev\_environment工作空间下对所有数据进行读写操作，并可以创建和删除table、view等对象；可以使用dev\_environment工作空间下所有的计算集群资源；可以提交并维护dev\_environment工作空间下的周期任务。

**analyst用户**，可以使用“开发”功能；对schema ADS 下的所有表和视图具备只读权限，对表stg.employees具备只读权限；可以使用dev\_environmentt工作空间下所有的计算集群资源。

为了达到以上效果，需要继续使用创建dev\_environment工作空间的用户，打开“开发”功能，新建SQL脚本，并执行以下授权语句：

```SQL
----------------------------------------------------------
-- 1. 为developer用户授权
----------------------------------------------------------
--将用户developer加入工作空间，仅加入工作空间后，才可以授予该工作空间下元数据对象的权限
CREATE USER developer;

--为用户developer授予workspace_dev角色,以具备以下权限“可以使用'开发'功能；可以在dev_environment工作空间下对所有数据进行读写操作，并可以创建和删除table、view等对象；可以使用dev_environment工作空间下所有的计算集群资源；”
GRANT ROLE workspace_dev TO USER developer;

--为用户developer授予workspace_sre角色，已具备“可以提交并维护dev_environment工作空间下的周期任务”的权限
GRANT ROLE workspace_sre TO USER developer;


----------------------------------------------------------
-- 2. 为analyst用户授权
----------------------------------------------------------
--将用户analyst加入工作空间，仅加入工作空间后，才可以授予该工作空间下元数据对象的权限
CREATE USER analyst;

--为用户analyst授予workspace_analyst角色,以具备以下权限“可以使用'开发'功能；可以使用dev_environment工作空间下所有的计算集群资源；”
GRANT ROLE workspace_analyst TO USER analyst;

--为用户analyst授予单独授予部分数据权限，以实现“对schema ADS 下的所有表和视图具备只读权限”
GRANT SELECT, READ METADATA ON ALL TABLES IN SCHEMA ads TO USER analyst;
GRANT SELECT, READ METADATA ON ALL VIEWS IN SCHEMA ads TO USER analyst;

--为用户analyst授予单独授予部分数据权限，以实现“对表stg.employees具备只读权限”
GRANT SELECT, READ METADATA ON TABLE stg.employees TO USER analyst;

```

上述授权操作中，将用户加入工作空间和授予角色的操作也可以通过WEB页面操作完成。

**web端加入工作空间操作**

继续使用创建dev\_environment工作空间的用户，点击左侧菜单“管理”-“工作空间”，进入工作空间列表，找到dev\_environment工作空间，点击进入。在工作空间详情页面的“用户”页签右侧点击“+添加用户”按钮：

:-: ![](.topwrite/assets/quickstart_team_p10.png =774)

^

在弹窗中找到用户 developer 并勾选（可以同时找到 analyst 用户，一起勾选。但是因为两个用户要授予的权限不同，此处分开操作，仅先添加 developer 用户）。

:-: ![](.topwrite/assets/quickstart_team_p11.png =763)

^

此时下方有两个按钮，点击右边的“添加用户”，仅执行添加用户进入工作空间的操作，不做任何授权。点击左边的“添加用户并授予角色”，可以进一步选择要授予的角色。假设我们点击左边的“添加用户并授予角色”按钮：

:-: ![](.topwrite/assets/quickstart_team_p12.png =772)

^

在可授予的角色中，我们选择“workspace\_dev"角色，勾选并点击”角色授予“。

完成上述操作后，我们即完成了对用户developer的加入工作空间和授权操作。效果和上述SQL执行的授权等价。

对用户analyst的授权操作，由于包含“单独授予部分数据权限”的操作，这部分操作推荐使用SQL的GRANT语句执行授权，更为便利。

### 3.6 检查授权结果

Lakehouse支持使用SHOW GRANTS语句查询用户已授予的权限。

在“开发”功能中执行以下语句：

```SQL
SHOW GRANTS TO USER developer;
```

返回结果如下：

:-: ![](.topwrite/assets/quickstart_team_p13.png =738)

^

### 3.7 团队成员登录系统

完成上述操作后，developer和analyst两个用户均可以登录Lakehouse，并具备了相应的权限可以进行数据开发或查询。下面使用developer用户登录系统。

回到云器的登录页面<https://accounts.clickzetta.com/login>，依次输入账户名称、用户名和密码。其中账户名称在账号注册成功后提供，并可在该账户任意用户登录后的 URL 中获取。

:-: ![](.topwrite/assets/quickstart_team_p15.png =746)

现在使用developer用户，在<账户名称>.accounts.clickzetta.com/login URL登录，并点击“Lakehouse”产品下“进入”服务实例按钮，进入Lakehouse服务实例中。

:-: ![](.topwrite/assets/quickstart_team_p16.png =740)

### 3.8 团队成员编写开发任务

developer用户登录后，在左侧菜单中进入“开发”页面。因当前developer用户只加入了dev\_envirment这一个工作空间，所以无需切换工作空间。如果加入多个工作空间，可以在右上角切换所需进行开发的工作空间。

:-: ![](.topwrite/assets/quickstart_team_p17.png =739)

^

点击“开发”功能的“+”新建SQL脚本，写一条查询语句查询 stg.employees 表中的数据。

:-: ![](.topwrite/assets/quickstart_team_p18.png =717)

^

```SQL
select * from stg.employees limit 10;
```

:-: ![](.topwrite/assets/quickstart_team_p19.png =740)

^

依次点击“保存”按钮保存任务代码，点击“调度”按钮打开调度配置弹窗。

:-: ![](.topwrite/assets/quickstart_team_p20.png =572)

^

在弹窗中配置调度任务的周期、重跑方式等信息，然后点击“确定”按钮，即完成该任务的调度配置操作。

:-: ![](.topwrite/assets/quickstart_team_p21.png =730)

^

成功配置调度后，“提交”按钮变为可点击状态。点击“提交”后，该任务即提交为周期调度运行。

:-: ![](.topwrite/assets/quickstart_team_p22.png =695)

^

以上即完成了从创建用户、授权到使用新用户开发SQL任务并提交周期调度运行的过程。
