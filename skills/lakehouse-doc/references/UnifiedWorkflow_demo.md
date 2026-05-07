# 基于云器 Lakehouse 的车辆图像智能识别案例

### 概述

云器 Lakehouse 创新性地提供了 **AI + BI 统一工作流**解决方案，将传统的数据处理流程与 AI 数据应用流程无缝整合在同一平台上，实现真正的数据智能融合。本文以车辆图像识别为例，展示如何构建一个完整的 AI + BI 统一工作流。

### 业务场景

某智慧交通管理平台需要：

* 实时处理来自各路口摄像头的车辆图像
* 自动识别车辆型号、颜色、年份等信息
* 构建车辆特征数据库，支持后续的交通分析和管理决策

### 架构设计

```
OSS 图像存储 →  Volume 数据湖 →  AI 识别处理  →  结构化存储  →   BI 分析展示
     ↓              ↓              ↓            ↓            ↓
  原始图像         增量检测       AI UDF调用     数据解析入库   可视化报表
```

### 工作流实现

![](.topwrite/assets/AIworkflow.png =743)

#### **Task 1: 数据源刷新与增量检测**

```sql
-- 刷新 Volume，检测新增图像文件
ALTER VOLUME sg_volume_images REFRESH;

-- 记录刷新时间点，用于后续增量处理
SET refresh_timestamp = CURRENT_TIMESTAMP();
```

**最佳实践要点**：

* 定期刷新 Volume 以发现新文件
* 使用时间戳记录刷新点，支持增量处理
* 建议根据业务需求设置合理的刷新频率（如每 5 分钟）

#### **Task 2: AI 识别与结构化处理**

```sql
-- 增量处理最近 ${last_min} 分钟内的新图像
WITH check_new_files AS (
    SELECT COUNT(*) AS file_count
    FROM DIRECTORY(VOLUME sg_volume_images)
    WHERE last_modified_time >= DATEADD(MINUTE, -${last_min}, CURRENT_TIMESTAMP())
),
-- AI 识别处理
recognition AS (
    SELECT *
    FROM (
        SELECT 
            relative_path as vehicle_images,
            pre_signed_url,
            -- 调用 AI 外部函数进行车辆识别
            public.fc_image_to_text('vehicle_type', pre_signed_url) as vehicle_recognition,
            last_modified_time
        FROM (
            SELECT 
                relative_path,
                -- 生成临时访问 URL，有效期 2 小时
                get_presigned_url(volume sg_volume_images, relative_path, 7200) as pre_signed_url,
                last_modified_time
            FROM DIRECTORY(VOLUME sg_volume_images)
            WHERE last_modified_time >= DATEADD(MINUTE, -${last_min}, CURRENT_TIMESTAMP())
        )
    ) subq
    WHERE EXISTS (SELECT 1 FROM check_new_files WHERE file_count > 0)
)
-- 解析 AI 返回的 JSON 结果并入库
INSERT INTO vehicle_type_data (
    car_model, car_color, year, score, 
    vehicle_recognition, pre_signed_url, last_modified_time, process_time
)
SELECT 
    get_json_object(regexp_replace(vehicle_recognition, "'", '"'), '$.result[0].name') as car_model,
    get_json_object(regexp_replace(vehicle_recognition, "'", '"'), '$.color_result') as car_color,
    get_json_object(regexp_replace(vehicle_recognition, "'", '"'), '$.result[0].year') as year,
    cast(get_json_object(regexp_replace(vehicle_recognition, "'", '"'), '$.result[0].score') as decimal(16,6)) as score,
    vehicle_recognition,
    r.pre_signed_url,
    last_modified_time,
    CURRENT_TIMESTAMP() as process_time
FROM recognition r
WHERE EXISTS (SELECT 1 FROM check_new_files WHERE file_count > 0);
```

**最佳实践要点**：

* 使用 CTE 进行增量检测，避免处理已识别的图像
* 生成预签名 URL 供 AI 服务访问，确保安全性
* JSON 解析时注意引号转换和数据类型转换
* 记录处理时间，便于监控和审计

#### **Task 3: 数据质量控制与异常处理**

```sql
-- 数据质量检查和异常处理
WITH quality_check AS (
    -- 检查识别失败的记录
    SELECT 
        vehicle_images,
        pre_signed_url,
        vehicle_recognition,
        CASE 
            WHEN vehicle_recognition IS NULL THEN 'AI服务调用失败'
            WHEN score < 0.6 THEN '识别置信度过低'
            WHEN car_model IS NULL THEN '车型识别失败'
            ELSE '正常'
        END as quality_status
    FROM vehicle_type_data
    WHERE process_time >= DATEADD(MINUTE, -${last_min}, CURRENT_TIMESTAMP())
)
-- 将异常记录写入错误日志表
INSERT INTO vehicle_recognition_errors (
    vehicle_images, pre_signed_url, error_type, 
    error_details, retry_count, created_time
)
SELECT 
    vehicle_images,
    pre_signed_url,
    quality_status as error_type,
    vehicle_recognition as error_details,
    0 as retry_count,
    CURRENT_TIMESTAMP() as created_time
FROM quality_check
WHERE quality_status != '正常';

-- 更新处理统计信息
MERGE INTO vehicle_process_stats AS target
USING (
    SELECT 
        DATE(CURRENT_TIMESTAMP()) as process_date,
        COUNT(*) as total_processed,
        SUM(CASE WHEN quality_status = '正常' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN quality_status != '正常' THEN 1 ELSE 0 END) as error_count
    FROM quality_check
) AS source
ON target.process_date = source.process_date
WHEN MATCHED THEN UPDATE SET
    total_processed = target.total_processed + source.total_processed,
    success_count = target.success_count + source.success_count,
    error_count = target.error_count + source.error_count,
    last_update_time = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT (
    process_date, total_processed, success_count, 
    error_count, last_update_time
) VALUES (
    source.process_date, source.total_processed, 
    source.success_count, source.error_count, CURRENT_TIMESTAMP()
);
```

**最佳实践要点**：

* 实施数据质量检查，识别低质量结果
* 建立错误处理机制，支持后续重试
* 维护处理统计信息，便于监控系统健康度

### 最佳实践总结

1.  **统一平台优势**
    * 数据存储、AI 处理、BI 分析在同一平台完成
    * 避免数据搬迁，降低延迟和成本
    * 统一的权限管理和数据治理

2.  **增量处理策略**
    * 使用时间戳实现增量识别，避免重复处理
    * 设置合理的处理批次大小，平衡实时性和资源消耗

通过这个完整的 AI + BI 统一工作流，企业可以快速构建从数据采集、AI 处理到业务分析的端到端智能应用，真正实现数据驱动的业务决策。
