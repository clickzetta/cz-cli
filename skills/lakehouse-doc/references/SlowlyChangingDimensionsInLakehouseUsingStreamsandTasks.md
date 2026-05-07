# 通过流、管道和SQL任务在 Lakehouse 上实现数仓缓慢变化维SCD

## 关于SCD

缓慢变化维 (Slowly Changing Dimensions, SCD) 是数据仓库设计中的一个关键概念，用于处理维度表中的数据在随时间变化时的管理。维度表包含描述性数据，例如客户信息、产品信息等，而这些信息可能会随时间发生变化。SCD提供了一种方法来处理和记录这些变化，以便数据仓库中的历史数据和当前数据都能保持一致和准确。

SCD通常分为几种类型：

### SCD 类型 1

SCD 类型 1 通过覆盖旧数据来处理变化。这意味着当维度数据发生变化时，旧的数据将被新数据覆盖，因此不会保留历史记录。这种方法简单且快速，但会丢失历史数据。

**示例**：假设客户的地址发生了变化，SCD 类型 1 将直接更新客户地址字段，旧的地址信息将被新地址覆盖。

### SCD 类型 2

SCD 类型 2 通过创建新行来处理变化，以保留历史记录。这种方法在维度表中添加一个新的记录，并且用新数据更新它，同时保留旧数据行，并可能使用有效日期列或版本列来跟踪不同版本的数据。

**示例**：当客户的地址发生变化时，SCD 类型 2 将在维度表中插入一条新的记录，包含新地址，并可能添加一个有效日期范围来表示该地址的有效期。

### SCD 类型 3

SCD 类型 3 通过在表中添加额外的列来处理变化，以保留有限的历史记录。这种方法在维度表中添加一个新列来存储旧数据，当变化发生时，旧数据移到新列，新数据覆盖原来的位置。

**示例**：如果客户的地址变化，SCD 类型 3 会在表中添加一个“旧地址”列，将旧地址存储到该列中，新地址存储在原始列中。

### 需要什么

* [云器Lakehouse](https://www.yunqi.tech/)账户
* 本指南的[Github代码库](https://github.com/yunqiqiliang/clickzetta_quickstart/tree/main/Slowly_Changing_Dimensions_In_Lakehouse_Using_Streams_and_Tasks)
* 访问阿里云OSS的AK信息

## 在Lakehouse上实现SCD方案介绍

在 Lakehouse 中实现缓慢变化维度 (SCD) 的现代方法，利用自动化数据管道和原生 Lakehouse 功能实现高效的变化跟踪和历史数据管理。

^

:-: ![](.topwrite/assets/image_1736735808312.png =823)

^

### 管道概述

自动捕获和处理数据变化的端到端数据管道：

1. **数据源**（Jupyter 调用 Fake 生成测试数据）**→** 使用 Python 创建数据来模拟现实世界事件。
2. [Zettapark](ZettaparkQuickStart.md) **PUT**→ 使用Zettapark将数据拉取并加载到 数据湖Volume上。
3. [数据湖Volume](datalake_volume.md) → 基于阿里云OSS的数据湖存储。
4. [Lakehouse Pipe](pipe-summary.md)**捕捉数据湖文件变化**→ Lakehouse Pipe 高效地将数据从数据湖Volume流式传输到 Lakehouse。
5. [Lakehouse Table Stream](table_stream.md)**捕捉Table数据变化**→ 捕捉基表里的变化数据供增量消费。
6. **SQL**[任务](ide.md)**进行SCD处理 →** 通过开发SQL任务实现SCD的处理逻辑，并通过云器Lakehouse Studio实现任务调度。
7. **Lakehouse数据管理**，Lakehouse 通过三个表管理数据：

   * `customer_raw`：存储原始摄取数据。
   * `customer`：反映流管道的最新更新。
   * `customer_history`：保留所有更新的记录以供分析和审计变化历史。

## 关键组件

### 数据生成

* **使用的工具**： Python
* Python 脚本动态生成模拟客户数据以模拟实时数据源。

### 数据采集​​层

* **数据湖 Volume**：源文件的存储区，Lakehouse 的数据湖存储，本案例采用阿里云 OSS。通过创建外部 Volume 实现和 Table 的统一管理。

* **Zettapark**：将生成的模拟数据 PUT 到数据湖 Volume 上

* **Pipe**：Lakehouse内置的实时数据提取服务，使用 Pipe 进行实时流式传输

  * 自动检测 数据湖Volume 中的新文件
  * 无需人工干预即可将数据加载到临时表customer\_raw中

### 变化检测层

* **Lakehouse 流（Table Stream）**：

  * 捕获 INSERT、UPDATE、DELETE 等操作
  * 维护变更跟踪元数据
  * 能够高效处理增量变更
  * 将从customer中检测到的变化数据存储到中customer\_table\_changes

### 处理层

* **Lakehouse SQL任务**：

  * SCD 处理的计划作业
  * 处理类型 1（覆盖）和类型 2（历史）更改
  * 维护参照完整性
  * 任务
    * 将新的或更新的记录插入`customer`表（SCD 类型1）中。
    * 将更新记录到`customer_history`表（SCD 类型2）中以保留审计跟踪。

### 存储层

* **临时表**：原始数据的临时存储区

* **维度表**：具有历史跟踪的最终表

  * 包括生效日期
  * 维护当前和历史记录
  * 支持时间点分析

### 应用场景

* 客户维度管理
* 产品目录版本控制
* 员工数据追踪
* 任何需要历史变更跟踪的维度

### 技术堆栈

所需组件：

* 云器Lakehouse
* 阿里云OSS（数据湖存储）
* [Jupyter Notebook](https://jupyter.org/install)（用于测试数据生成并将文件PUT到数据湖Volume上），或其它Python环境

## 实现步骤

### 任务开发

导航到 [Lakehouse Studio](studio_overview.md) 的 开发 -> 任务，

^

:-: ![](.topwrite/assets/image_1736424981726.png =537)

^

单击“+”新建如下目录：

* 01\_DEMO\_SCD\_In\_Lakehouse

单击“+”新建如下SQL任务：

* 01\_setup\_env
* 10\_table\_creation\_for\_data\_storage
* 11\_stream\_creation\_for\_change\_detect
* 12\_volume\_creation\_for\_datalake
* 13\_pipe\_creation\_for\_data\_ingestion
* 14\_scd\_type\_1
* 15\_scd\_type\_2\_1
* 16\_scd\_type\_2\_2
* 20\_clean\_env

将如下代码复制到对应的任务里，也可以从[GitHub下载文件](https://github.com/yunqiqiliang/clickzetta_quickstart/tree/main/Slowly_Changing_Dimensions_In_Lakehouse_Using_Streams_and_Tasks)后将内容复制到对应的任务里。

^

#### Lakehouse环境设置

SQL任务：01\_setup\_env

```SQL
-- Create required virtual cluster and schemas
-- SCD virtual cluster
CREATE VCLUSTER IF NOT EXISTS SCD_VC
   VCLUSTER_SIZE = XSMALL
   VCLUSTER_TYPE = ANALYTICS
   AUTO_SUSPEND_IN_SECOND = 60
   AUTO_RESUME = TRUE
   COMMENT  'SCD VCLUSTER for test';

-- Use our VCLUSTER
USE VCLUSTER SCD_VC;

-- Create and Use SCHEMA
CREATE SCHEMA IF NOT EXISTS  SCD_SCH;
USE SCHEMA SCD_SCH;
```

> 注：计算集群的vcluster\_size参数同时支持以T-shirt size（XSMALL、SMALL、Large等）和以数字（1,2,4,16等）表达的方式，以提供更丰富的计算集群规格，满足不同场景的需要。更多信息详见：[计算集群规格代码变更说明](vcluster_size_description.md)

#### 创建表

SQL任务：10\_table\_creation\_for\_data\_storage

```SQL
USE VCLUSTER SCD_VC;
USE SCHEMA SCD_SCH;

create  table if not exists customer (
     customer_id string,
     first_name varchar,
     last_name varchar,
     email varchar,
     street varchar,
     city varchar,
     state varchar,
     country varchar,
     update_timestamp timestamp_ntz default current_timestamp());

create  table if not exists customer_history (
     customer_id string,
     first_name varchar,
     last_name varchar,
     email varchar,
     street varchar,
     city varchar,
     state varchar,
     country varchar,
     start_time timestamp_ntz default current_timestamp(),
     end_time timestamp_ntz default current_timestamp(),
     is_current boolean
     );
     
create  table if not exists customer_raw (
     customer_id string,
     first_name varchar,
     last_name varchar,
     email varchar,
     street varchar,
     city varchar,
     state varchar,
     country varchar);
```

#### 创建流（Stream）

SQL任务：11\_stream\_creation\_for\_change\_detect

```SQL
USE VCLUSTER SCD_VC;
USE SCHEMA SCD_SCH;
     
create table stream if not exists customer_table_changes 
on table customer 
WITH PROPERTIES('TABLE_STREAM_MODE' = 'STANDARD');
```

#### 创建数据湖Volume

SQL任务：12\_volume\_creation\_for\_datalake

创建 Volume 需要一个到阿里云 OSS 的 Connection，请参考 [创建Connection](connection-guide.md)。

```SQL
--external data lake
--创建数据湖Connection,到数据湖的连接
CREATE STORAGE CONNECTION if not exists hz_ingestion_demo
    TYPE oss
    ENDPOINT = 'oss-cn-hangzhou-internal.aliyuncs.com'
    access_id = '请输入您的access_id'
    access_key = '请输入您的access_key'
    comments = 'hangzhou oss private endpoint for ingest demo'
```

```SQL
USE VCLUSTER SCD_VC;
USE SCHEMA SCD_SCH;

--创建Volume,数据湖存储文件的位置
CREATE EXTERNAL VOLUME  if not exists scd_demo
  LOCATION 'oss://yourbucketname/scd_demo' 
  USING connection hz_ingestion_demo  -- storage Connection
  DIRECTORY = (
    enable = TRUE
  ) 
  recursive = TRUE;

--同步数据湖Volume的目录到Lakehouse
ALTER volume scd_demo refresh;

--查看云器Lakehouse数据湖Volume上的文件
SELECT * from directory(volume scd_demo);
  
show volumes;
```

#### 创建Pipe

SQL任务：13\_pipe\_creation\_for\_data\_ingestion

```SQL
USE VCLUSTER SCD_VC;
USE SCHEMA SCD_SCH;

create pipe volume_pipe_cdc_demo
  VIRTUAL_CLUSTER = 'scd_vc'
  --执行获取最新文件使用扫描文件模式
  INGEST_MODE = 'LIST_PURGE'
  as
copy into customer_raw from volume scd_demo(customer_id string,
     first_name varchar,
     last_name varchar,
     email varchar,
     street varchar,
     city varchar,
     state varchar,
     country varchar) 
using csv OPTIONS(
  'header'='true'
)
--必须添加purge参数导入成功后删除数据 
purge=true
;

show pipes;
DESC PIPE volume_pipe_cdc_demo;
```

#### SCD Type 1

SQL任务：14\_scd\_type\_1

```SQL
USE VCLUSTER SCD_VC;
USE SCHEMA SCD_SCH;

MERGE INTO customer AS c 
USING customer_raw AS cr
   ON c.customer_id = cr.customer_id
WHEN MATCHED AND (c.first_name  <> cr.first_name  OR
                  c.last_name   <> cr.last_name   OR
                  c.email       <> cr.email       OR
                  c.street      <> cr.street      OR
                  c.city        <> cr.city        OR
                  c.state       <> cr.state       OR
                  c.country     <> cr.country) THEN 
    UPDATE SET 
        c.first_name = cr.first_name,
        c.last_name = cr.last_name,
        c.email = cr.email,
        c.street = cr.street,
        c.city = cr.city,
        c.state = cr.state,
        c.country = cr.country,
        c.update_timestamp = current_timestamp()
WHEN NOT MATCHED THEN 
    INSERT (customer_id, first_name, last_name, email, street, city, state, country)
    VALUES (cr.customer_id, cr.first_name, cr.last_name, cr.email, cr.street, cr.city, cr.state, cr.country);

select count(*) from customer;
```

#### SCD Type 2-1

SQL任务：15\_scd\_type\_2\_1

```SQL
USE VCLUSTER SCD_VC;
USE SCHEMA SCD_SCH;

-- 创建视图 v_customer_change_data
CREATE VIEW IF NOT EXISTS v_customer_change_data AS
-- 这个子查询用于处理插入到 customer 表的数据
-- 插入到 customer 表的数据会在 customer_HISTORY 表中产生一条新的插入记录
SELECT CUSTOMER_ID, FIRST_NAME, LAST_NAME, EMAIL, STREET, CITY, STATE, COUNTRY,
       start_time, end_time, is_current, 'I' AS dml_type
FROM (
    SELECT CUSTOMER_ID, FIRST_NAME, LAST_NAME, EMAIL, STREET, CITY, STATE, COUNTRY,
           update_timestamp AS start_time,
           LAG(update_timestamp) OVER (PARTITION BY customer_id ORDER BY update_timestamp DESC) AS end_time_raw,
           CASE WHEN end_time_raw IS NULL THEN '9999-12-31' ELSE end_time_raw END AS end_time,
           CASE WHEN end_time_raw IS NULL THEN TRUE ELSE FALSE END AS is_current
    FROM (
        SELECT CUSTOMER_ID, FIRST_NAME, LAST_NAME, EMAIL, STREET, CITY, STATE, COUNTRY, UPDATE_TIMESTAMP
        FROM customer_table_changes
        WHERE __change_type = 'INSERT'
    )
)
UNION
-- 这个子查询用于处理更新到 customer 表的数据
-- 更新到 customer 表的数据会在 customer_HISTORY 表中产生一条更新记录和一条插入记录
-- 下面的子查询会生成两条记录，每条记录有不同的 dml_type
SELECT CUSTOMER_ID, FIRST_NAME, LAST_NAME, EMAIL, STREET, CITY, STATE, COUNTRY, start_time, end_time, is_current, dml_type
FROM (
    SELECT CUSTOMER_ID, FIRST_NAME, LAST_NAME, EMAIL, STREET, CITY, STATE, COUNTRY,
           update_timestamp AS start_time,
           LAG(update_timestamp) OVER (PARTITION BY customer_id ORDER BY update_timestamp DESC) AS end_time_raw,
           CASE WHEN end_time_raw IS NULL THEN '9999-12-31' ELSE end_time_raw END AS end_time,
           CASE WHEN end_time_raw IS NULL THEN TRUE ELSE FALSE END AS is_current, 
           dml_type
    FROM (
        -- 识别需要插入到 customer_history 表的数据
        SELECT CUSTOMER_ID, FIRST_NAME, LAST_NAME, EMAIL, STREET, CITY, STATE, COUNTRY, update_timestamp, 'I' AS dml_type
        FROM customer_table_changes
        WHERE __change_type = 'INSERT'
        UNION
        -- 识别 customer_HISTORY 表中需要更新的数据
        SELECT CUSTOMER_ID, null AS FIRST_NAME, null AS LAST_NAME, null AS EMAIL, null AS STREET, null AS CITY, null AS STATE, null AS COUNTRY, start_time, 'U' AS dml_type
        FROM customer_history
        WHERE customer_id IN (
            SELECT DISTINCT customer_id 
            FROM customer_table_changes
            WHERE __change_type = 'DELETE'
        )
        AND is_current = TRUE
    )
)
UNION
-- 这个子查询用于处理从 customer 表中删除的数据
-- 从 customer 表中删除的数据会在 customer_HISTORY 表中产生一条更新记录
SELECT ctc.CUSTOMER_ID, null AS FIRST_NAME, null AS LAST_NAME, null AS EMAIL, null AS STREET, null AS CITY, null AS STATE, null AS COUNTRY, ch.start_time, current_timestamp() AS end_time, NULL AS is_current, 'D' AS dml_type
FROM customer_history ch
INNER JOIN customer_table_changes ctc
ON ch.customer_id = ctc.customer_id
WHERE ctc.__change_type = 'DELETE'
AND ch.is_current = TRUE;
```

#### SCD Type 2-2

SQL任务：16\_scd\_type\_2\_2

```SQL
USE VCLUSTER SCD_VC;
USE SCHEMA SCD_SCH;

merge into customer_history ch -- 目标表，将 NATION 中的变化合并到此表中
using v_customer_change_data ccd -- v_customer_change_data 是一个视图，包含插入/更新到 customer_history 表的逻辑。
   on ch.CUSTOMER_ID = ccd.CUSTOMER_ID -- CUSTOMER_ID 和 start_time 确定 customer_history 表中是否存在唯一记录
   and ch.start_time = ccd.start_time
when matched and ccd.dml_type = 'U' then update -- 表示记录已被更新且不再是当前记录，需要标记 end_time
    set ch.end_time = ccd.end_time,
        ch.is_current = FALSE
when matched and ccd.dml_type = 'D' then update -- 删除实际上是逻辑删除。记录会被标记且不会插入新版本
   set ch.end_time = ccd.end_time,
       ch.is_current = FALSE
when not matched and ccd.dml_type = 'I' then insert -- 插入一个新的 CUSTOMER_ID 或更新现有 CUSTOMER_ID 都会产生一个插入操作
          (CUSTOMER_ID, FIRST_NAME, LAST_NAME, EMAIL, STREET, CITY, STATE, COUNTRY, start_time, end_time, is_current)
    values (ccd.CUSTOMER_ID, ccd.FIRST_NAME, ccd.LAST_NAME, ccd.EMAIL, ccd.STREET, ccd.CITY, ccd.STATE, ccd.COUNTRY, ccd.start_time, ccd.end_time, ccd.is_current);
```

### 构建环境

运行开发好的任务，构建Lakehouse运行环境。
导航到开发->任务页面，打开如下任务并逐一运行：

* 01\_setup\_env
* 10\_table\_creation\_for\_data\_storage
* 11\_stream\_creation\_for\_change\_detect
* 12\_volume\_creation\_for\_datalake
* 13\_pipe\_creation\_for\_data\_ingestion
* 15\_scd\_type\_2\_1

:-: ![](.topwrite/assets/image_1736480652293.png =594)

### 任务调度与提交运行

调度开发好的 SCD 任务，每分钟执行一次。
导航到开发->任务页面，打开如下任务并逐一配置调度：

* 14\_scd\_type\_1
* 16\_scd\_type\_2\_2

:-: ![](.topwrite/assets/image_1736480815329.png =623)

### 提交任务

配置好调度后，点击“提交”，任务将以一分钟的周期进行调度运行，更新目标表里的数据。

^

:-: ![](.topwrite/assets/image_1736480973764.png =624)

### 生成测试数据

#### 生成测试数据并PUT到数据湖Volume上

```PYTHON
#!pip install faker
from faker import Faker
import csv
import uuid
import random
from decimal import Decimal
from datetime import datetime
from clickzetta.zettapark.session import Session
import json
RECORD_COUNT = 10000
fake = Faker()
```

```PYTHON
current_time = datetime.now().strftime("%Y%m%d%H%M%S")
print(current_time)
```

```PYTHON
file_path = f'FakeDataset/customer_{current_time}.csv'
```

```PYTHON
def create_csv_file():
    with open(file_path, 'w', newline='') as csvfile:
        fieldnames = ["customer_id","first_name","last_name","email","street",
                      "city","state","country"
                     ]
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)

        writer.writeheader()
        for i in range(RECORD_COUNT):
            #print(i)
            writer.writerow(
                {
                    "customer_id": str(uuid.uuid4()),
                    'first_name': fake.first_name(),
                    'last_name': fake.last_name(),
                    'email': fake.email(),
                    'street': fake.street_address(),
                    'city': fake.city(),
                    'state': fake.state(),
                    'country': fake.country()
                }
            )
```

```PYTHON
def put_file_into_volume():
    # 从配置文件中读取参数
    with open('security/config-uat.json', 'r') as config_file:
        config = json.load(config_file)
    
    # 创建会话
    session = Session.builder.configs(config).create()
    session.file.put(file_path,"volume://scd_demo/")
    session.sql("show volume directory scd_demo").show()
    session.close()
```

```PYTHON
if __name__ == '__main__':
    create_csv_file()
    put_file_into_volume()
```

* 执行上述代码，会往Volume里PUT一个新文件，Pipe会自动检测到该新文件并文件的数据写入到customer\_raw表里。

:-: ![](.topwrite/assets/image_1736481547753.png =403)

* 14\_scd\_type\_1任务配置了周期调度，每分钟会进行scd\_type\_1的计算并将结果merge into进customer表。

:-: ![](.topwrite/assets/image_1736481597919.png =419)

* Table Stream会自动检测customer表数据的变化，并将变化数据保存在customer\_table\_changes。

:-: ![](.topwrite/assets/image_1736481635363.png =416)

* 14\_scd\_type\_2\_2任务配置了周期调度，每分钟会进行scd\_type\_2的计算并将结果merge into进customer\_history表。

:-: ![](.topwrite/assets/image_1736481671328.png =425)

### 监控和维护

#### Pipe监控

* 使用SHOW PIPES命令查看PIPE对象列表

```SQL
SHOW PIPES;
```

* 使用DESC PIPE命令查看指定PIPE对象详细信息

```SQL
DESC PIPE volume_pipe_cdc_demo;
```

:-: ![](.topwrite/assets/image_1736483133453.png =562)

* 查看pipe copy作业执行情况

通过作业历史中的query\_tag来筛选,所有的pipe执行的copy作业都会在query\_tag打上标签:格式为pipe.worksapce\_name.schema\_name.pipe\_name

本指南worksapce\_name是ql\_ws，schema\_name是SCD\_SCH，pipe name是volume\_pipe\_cdc\_demo，因此query\_tag是：

pipe.ql\_ws.scd\_sch.volume\_pipe\_cdc\_demo

导航到计算->作业历史：

^

:-: ![](.topwrite/assets/image_1736482319263.png =553)

^

点击“更多筛选”，在QueryTag里输入“pipe.ql\_ws.scd\_sch.volume\_pipe\_cdc\_demo”进行过滤：

:-:
![](.topwrite/assets/image_1736482668378.png =617)

####

#### 周期调度任务

导航到运维监控->任务运维->周期任务：

:-:
![](.topwrite/assets/image_1736482942259.png =634)

^

查看任务实例：

^

:-: ![](.topwrite/assets/image_1736483055041.png =627)

^

## 资料

[Connection](connection-guide.md)

[External Volume](datalake_volume.md)

[Pipe](pipe-storage-object.md)

[Table Stream](table_stream.md)

[Merge Into](MERGE.md)
