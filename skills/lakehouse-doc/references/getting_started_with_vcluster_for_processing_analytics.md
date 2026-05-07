# 使用虚拟集群加工和分析数据

## 教程概述

通过本教程，您将了解到如何使用虚拟集群（Virtual Cluster）对纽约出租车公开数据集 Fhvhv trips 原始数据进行清洗转换、聚合加工，并对结果数据进行多并发查询。

教程案例如下图所示：
![](.topwrite/assets/image_1714992137097.png)

本教程包含以下步骤：

* 环境准备：通过样例数据集检查原始数据，创建计算集群和目标 Schema
* 数据转换：通过通用型集群清洗、聚合数据用于后续分析
* Ad-hoc分析：使用Studio Web环境进行单并发SQL查询分析
* 并发分析：通过Python任务模拟来自Dashboard的连续多并发查询

### 入门知识

什么是虚拟计算集群（Virtual Cluster）？

虚拟计算集群（Virtual Cluster，简称 VC 或集群）是云器 Lakehouse 提供数据处理和分析的计算资源对象。虚拟计算集群提供在Lakehouse中执行SQL作业所需的CPU、内存、本地临时存储（SSD介质）等资源。集群具备快速创建/销毁、扩容/缩容、暂停/恢复等特点，按照资源规格大小以及使用时长进行收费，暂停或删除后不产生费用。

虚拟计算集群针对 ETL 和分析场景，提供通用型和分析型两种集群类型，以满足不同负载之间的隔离和优化需求。

如下图所示：
![](.topwrite/assets/image_1714992266569.png)
建议使用通用型集群进行 ETL 数据加工，使用分析型集群进行查询分析或支持数据产品应用。通用型集群支持纵向伸缩，满足不同规模的 ETL Pipeline 任务需要。分析型集群支持集群内多副本（Replica）的横向伸缩，以满足并发查询的弹性需求。

本教程将分别使用通用型集群进行数据清洗转换，使用分析型集群进行低延迟的并发分析。

### 教程目标

* 创建和使用虚拟计算集群用于不同业务负载
* 了解和使用分析型集群的弹性并发功能

## Step01 检查原始数据

1. 创建虚拟集群

分别创建通用型（GENERAL PURPOSE）和分析型（ANALYTICS）集群，用于 ETL 加工和查询分析，实现负载隔离。

```sql
-- 1.1 创建面向ETL处理的虚拟集群
CREATE VCLUSTER ETL_VC 
VCLUSTER_SIZE = MEDIUM 
VCLUSTER_TYPE = GENERAL 
AUTO_SUSPEND_IN_SECOND = 60 
AUTO_RESUME = TRUE;

-- 1.2 创建面向BI分析的虚拟集群，设置弹性并发以支持多并发查询
CREATE VCLUSTER REPORTING_VC 
VCLUSTER_SIZE = XSMALL 
VCLUSTER_TYPE = ANALYTICS
MIN_REPLICAS = 1
MAX_REPLICAS = 4
MAX_CONCURRENCY = 8
AUTO_SUSPEND_IN_SECOND = 300 
AUTO_RESUME = TRUE ;

-- 1.3 查看集群资源
show  vclusters ;

-- 1.4 切换当前Session下使用的虚拟集群,要和执行的SQL一起选中执行才会生效
USE VCLUSTER REPORTING_VC;
```

![](.topwrite/assets/image_1714992453071.png)

> 注：计算集群的 `vcluster_size` 参数同时支持 T-shirt size（XSMALL、SMALL、LARGE 等）和数字（1, 2, 4, 16 等）两种表达方式，以提供更丰富的计算集群规格，满足不同场景的需要。更多信息详见：[计算集群规格代码变更说明](vcluster_size_description.md)

^

2. 查看公共数据集中的原始数据

2.1 查看原始数据的字段信息。

```sql
--Describes New York City For-Hire-Vehicle trips. 
desc clickzetta_sample_data.nyc_taxi_tripdata.fhvhv_tripdata;
```

![](.topwrite/assets/image_1714992471693.png)

2.2 预览数据明细

```sql
--Sample Of Trip Record Data
select * from clickzetta_sample_data.nyc_taxi_tripdata.fhvhv_tripdata limit 10;
```

![](.topwrite/assets/image_1714992501025.png)

2.3 查看数据集的记录数

```sql
--1.49 billion rows
select count(*) from clickzetta_sample_data.nyc_taxi_tripdata.fhvhv_tripdata;
```

## Step02 使用通用型集群清洗转换数据

1. 指定使用 `ETL_VC` 进行数据加工，同时创建目标表所在的 Schema

```sql
--要和执行的SQL一起选中执行才会生效
use vcluster ETL_VC;
create schema tutorial;
use tutorial;
```

2. 通过 CTAS 对原始数据集进行清洗转换并写入新表

```sql
--2.对原始数据集进行清洗转换
CREATE table tutorial.int_fhvhv_tripdata
as
SELECT
  hvfhs_license_num,
  CASE 
    WHEN hvfhs_license_num = 'HV0002' THEN 'juno'
    WHEN hvfhs_license_num = 'HV0003' THEN 'uber'
    WHEN hvfhs_license_num = 'HV0004' THEN 'via'
    WHEN hvfhs_license_num = 'HV0005' THEN 'lyft'
    ELSE null
  END AS company,
  ltrim(rtrim(upper(dispatching_base_num))) dispatching_base_num,
  ltrim(rtrim(upper(originating_base_num))) originating_base_num,
  request_datetime,
  on_scene_datetime,
  pickup_datetime,
  dropoff_datetime,
  PULocationID,
  DOLocationID,
  trip_miles,
  trip_time,
  base_passenger_fare,
  tolls,
  bcf,
  sales_tax,
  congestion_surcharge,
  airport_fee,
  tips,
  driver_pay,
  CASE
    WHEN shared_request_flag = 'Y' THEN true
    WHEN shared_request_flag IN ('N', ' ') THEN false
    ELSE null
  END AS shared_request_flag,
  CASE
    WHEN shared_match_flag = 'Y' THEN true
    WHEN shared_match_flag IN ('N', ' ') THEN false
    ELSE null
  END AS shared_match_flag,
  CASE
    WHEN access_a_ride_flag = 'Y' THEN true
    WHEN access_a_ride_flag IN ('N', ' ') THEN false
    ELSE null
  END AS access_a_ride_flag,
  CASE
    WHEN wav_request_flag = 'Y' THEN true
    WHEN wav_request_flag IN ('N', ' ') THEN false
    ELSE null
  END AS wav_request_flag,
  CASE
    WHEN wav_match_flag = 'Y' THEN true
    WHEN wav_match_flag IN ('N', ' ') THEN false
    ELSE null
  END AS wav_match_flag
FROM clickzetta_sample_data.nyc_taxi_tripdata.fhvhv_tripdata;
```

验证加工后的数据

```sql
SELECT * FROM tutorial.int_fhvhv_tripdata LIMIT 10;
```

![](.topwrite/assets/image_1714992818566.png)

3. 对清洗后的数据按照分析主题分别进行聚合计算，生成用于分析的数据表。

```sql
--Scenario 1: Analyze taxi trip patterns by time of day
CREATE table tutorial.mart_trips_pattern_by_time
AS
SELECT
  EXTRACT(HOUR FROM pickup_datetime) AS hour,
  COUNT(*) AS trip_count
FROM tutorial.int_fhvhv_tripdata
GROUP BY hour;

--Scenario 2: Analyze taxi trip patterns by day of the week
CREATE table tutorial.mart_trips_pattern_by_dayofweek
AS
SELECT
  EXTRACT(DAY FROM pickup_datetime) AS day_of_week,
  COUNT(*) AS trip_count
FROM tutorial.int_fhvhv_tripdata
GROUP BY day_of_week;

--Scenario 3: Analyze taxi trip patterns by pickup location
CREATE table tutorial.mart_trips_pattern_by_pickup_location
AS
SELECT
  PULocationID,
  COUNT(*) AS trip_count
FROM tutorial.int_fhvhv_tripdata
GROUP BY PULocationID;

--Scenario 4: Analyze taxi trip patterns by dropoff location
CREATE table tutorial.mart_trips_pattern_by_dropoff_location
AS
SELECT
  DOLocationID,
  COUNT(*) AS trip_count
FROM tutorial.int_fhvhv_tripdata
GROUP BY DOLocationID;

--Scenario 5:Trips per day
CREATE table tutorial.mart_trips_per_day
AS
SELECT
  pickup_datetime::date AS date,
  sum(trip_miles) AS trip_miles
FROM tutorial.int_fhvhv_tripdata
GROUP BY date;

--Scenario 6:Total driver pay per company
CREATE table tutorial.mart_trips_driver_pay_per_company
AS
SELECT
  CONCAT(YEAR(pickup_datetime), '-', MONTH(pickup_datetime)) AS year_month,
  company,
  sum(driver_pay) AS driver_pay
FROM tutorial.int_fhvhv_tripdata
GROUP BY year_month,company;
```

检查数据对象是否创建成功。

```sql
--检查新创建数据模型的状态
show tables in tutorial;
```

![](.topwrite/assets/image_1714992844915.png)

```sql
--检查新创建数据模型的数据
SELECT * FROM tutorial.mart_trips_driver_pay_per_company
WHERE substr(year_month,0,4)='2021'
ORDER BY year_month ASC;
```

![](.topwrite/assets/image_1714992852747.png)

## Step03 使用分析型集群单并发查询

1. 切换当前 Session 使用的虚拟集群为 REPORTING_VC。

```sql
-- 1.使用分析型VC进行加速查询分析，要和执行的SQL一起选中执行才会生效
USE VCLUSTER REPORTING_VC;
--设置查询作业标签，以便检索过滤，要和执行的SQL一起选中执行才会生效
SET QUERY_TAG = 'Tutorial02';
```

2. 串行执行 6 个业务分析查询。

```sql
--Scenario 1: Analyze taxi trip patterns by time of day
SELECT * FROM tutorial.mart_trips_pattern_by_time
ORDER BY HOUR ASC;

--Scenario 2: Analyze taxi trip patterns by day of the week
SELECT * FROM tutorial.mart_trips_pattern_by_dayofweek
ORDER BY day_of_week ASC;

--Scenario 3: Analyze taxi trip patterns by pickup location
SELECT * FROM tutorial.mart_trips_pattern_by_pickup_location
ORDER BY trip_count DESC
LIMIT 10;

--Scenario 4: Analyze taxi trip patterns by dropoff location
SELECT * FROM tutorial.mart_trips_pattern_by_dropoff_location
ORDER BY trip_count DESC
LIMIT 10;

--Scenario 5:Trips per day
SELECT * FROM tutorial.mart_trips_per_day
WHERE CONCAT(YEAR(date) , MONTH(date)) = '202110'
ORDER BY date;

--Scenario 6:Total driver pay per company
SELECT * FROM tutorial.mart_trips_driver_pay_per_company
WHERE substr(year_month,0,4)='2021'
ORDER BY year_month ASC;
```

3. 观察查询的 Latency 结果。

```sql
--清除QUERY_TAG
SET QUERY_TAG = '';
--查看运行的作业执行结果
SHOW JOBS WHERE QUERY_TAG='Tutorial02' LIMIT 10;
```

您还可以使用 Studio 页面的作业历史功能查看查询作业的执行情况。
![](.topwrite/assets/image_1714992890007.png)

## Step04 使用Python任务并发查询

通过Python任务进行并发查询测试，查看分析型集群在连续的动态并发查询下的性能表现以及弹性扩展能力。

1. 在 Studio 开发模块中，创建 Python 任务。
   ![](.topwrite/assets/image_1714992974205.png)

2. 通过 Lakehouse Python SDK 编写并发测试脚本

本教程的脚本实现了以下处理逻辑：

* 创建 Lakehouse 服务实例连接，指定工作空间、计算集群名称。
* 通过提交连续、梯度增加的并发查询，模拟多用户发起的 Dashboard 查询。
* 收集并打印并发查询下的 Latency 以及计算资源的弹性扩容状态变化。

```python
# Step 04: 使用Studio Python任务进行并发查询
# 操作步骤：
# 1.创建Lakehouse服务实例连接，指定工作空间、计算集群名称
# 2.通过提交连续、梯度增加并发查询来模拟多用户发起的Dashboard查询
# 3.观察连续并发查询下，分析型计算集群的动态弹性并发能力
# 
from clickzetta import connect
import random
import time
import concurrent.futures
import threading
from queue import Queue
from datetime import datetime

# 建立连接
conn = connect(
    username='xxx', # 替换为当前登录用户名
    password='xxx', # 替换登录密码
    service='region_id.api.clickzetta.com',
    instance='xxx', # 替换当前服务实例名称。可查看浏览器域名地址，格式为：<instance-name>.<Region_ID>.app.clickzetta.com。例如： 19d58db8.cn-shanghai-alicloud.app.clickzetta.com中，19d58db8代表服务实例名称。
    workspace='xxx', # 替换工作空间名称
    schema='tutorial',
    vcluster='reporting_vc'
)

queries = [
    """
    SELECT * FROM tutorial.mart_trips_pattern_by_time ORDER BY HOUR ASC;
    """,
    """
    SELECT * FROM tutorial.mart_trips_pattern_by_dayofweek ORDER BY day_of_week ASC;
    """,
    """
    SELECT * FROM tutorial.mart_trips_pattern_by_pickup_location ORDER BY trip_count DESC LIMIT 10;
    """,
    """
    SELECT * FROM tutorial.mart_trips_pattern_by_dropoff_location ORDER BY trip_count DESC LIMIT 10;
    """,
    """
    SELECT * FROM tutorial.mart_trips_per_day WHERE CONCAT(YEAR(date) , MONTH(date)) = '202110' ORDER BY date;
    """,
    """
    SELECT * FROM tutorial.mart_trips_driver_pay_per_company WHERE substr(year_month,0,4)='2021' ORDER BY year_month ASC;
    """
]
# 提交查询并计算时延
def submit_query_and_measure_latency(query):
    # 创建游标对象
    cursor = conn.cursor()
    start_time = time.time()
    # 执行 SQL 查询
    cursor.execute(query)
    # 获取查询结果
    results = cursor.fetchall()
    latency = time.time() - start_time
    return latency

# 查询任务
def query_task(barrier, query_queue, all_latencies):
    while True:
        # 等待所有线程准备好
        barrier.wait()

        # 提交查询任务
        query = query_queue.get()
        if query is None:
            break
        latency = submit_query_and_measure_latency(query)
        all_latencies.append(latency)
        query_queue.task_done()

# 查看计算集群的弹性并发配置动态变化
def check_cluster_concurrency_scaling():
    cursor = conn.cursor()
    # 执行 SQL 查询
    cursor.execute('desc vcluster reporting_vc;')
    # 获取查询结果
    results = cursor.fetchall()
    for row in results:
        if row[0] == 'current_replicas':
            print(row)

# 主函数
if __name__ == "__main__":
    num_concurrent_list = [4, 8, 12, 16]  # 不同并发量
    rounds = 30
    for num_threads in num_concurrent_list:
        print(f"---Running with {num_threads} concurrent queries:---")
        # 用于存储所有线程的结果的共享列表
        all_latencies = []

        # 创建查询队列
        query_queue = Queue()

        # 将查询任务放入队列
        for _ in range(num_threads):
            for _ in range(rounds):
                query = random.choice(queries)
                query_queue.put(query)

        # 创建 Barrier，等待所有线程同时准备好
        barrier = threading.Barrier(num_threads)

        # 创建并启动线程
        threads = []
        results = []
        start_times = []
        for _ in range(num_threads):
            thread = threading.Thread(target=query_task, args=(barrier, query_queue, all_latencies))
            thread.start()
            threads.append(thread)

        # 等待所有查询任务完成
        query_queue.join()

        # 停止线程
        for _ in range(num_threads):
            query_queue.put(None)
        for thread in threads:
            thread.join()

        # 计算指标
        all_latencies.sort()
        avg_latency = sum(all_latencies) / len(all_latencies)
        p95_index = int(len(all_latencies) * 0.95)
        p95_latency = all_latencies[p95_index]
        p99_index = int(len(all_latencies) * 0.99)
        p99_latency = all_latencies[p99_index]
        qps = len(all_latencies) / sum(all_latencies)

        # 打印结果
        print("Totoal Queries:", len(all_latencies))
        print("Average Latency:", avg_latency)
        print("P95 Latency:", p95_latency)
        print("P99 Latency:", p99_latency)
        print("Queries per Second (QPS):", qps)
        check_cluster_concurrency_scaling()
```

当设置 reporting_vc 的单 Replica 最大并发数为 4 时，打印结果示例如下：

* --Running with 4 concurrent queries:--- Total Queries: 120 Average Latency: 0.2201933761437734 P95 Latency: 0.43064022064208984 P99 Latency: 0.683488130569458 Queries per Second (QPS): 4.5414626793635176 ('current_replicas', '1') ---Running with 8 concurrent queries:--- Total Queries: 240 Average Latency: 0.20615292688210804 P95 Latency: 0.2397170066833496 P99 Latency: 0.4295358657836914 Queries per Second (QPS): 4.850767898977571 ('current_replicas', '2') ---Running with 12 concurrent queries:--- Total Queries: 360 Average Latency: 0.2232776681582133 P95 Latency: 0.27333879470825195 P99 Latency: 0.46774768829345703 Queries per Second (QPS): 4.478728250115035 ('current_replicas', '3') ---Running with 16 concurrent queries:--- Total Queries: 480 Average Latency: 0.23430742422739664 P95 Latency: 0.25676393508911133 P99 Latency: 0.4392051696777344 Queries per Second (QPS): 4.267897200856488 ('current_replicas', '4')

客户端分别模拟 4、8、12、16 四轮并发查询，每轮每个并发连续提交 30 次查询。可以观察到 `reporting_vc` 会根据客户端并发度动态增加副本（Replica）数量，在用户无感知集群动态扩容的前提下，保证不同并发数量下平均时延、P95、P99、QPS 指标保持稳定。
