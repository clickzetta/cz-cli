# Lakehouse 地理信息函数部署与使用指南

## 概述

本文档详细介绍如何在 ClickZetta Lakehouse 中部署和使用 Esri 地理信息函数，实现空间数据的存储、查询和分析。通过本指南，您将学会：

* 部署地理信息函数所需的 JAR 包
* 创建外部函数连接
* 批量创建常用的地理信息函数
* 在实际场景中使用这些函数，例如：
  * 地理围栏分析：判断门店是否在其对应的服务区域内 ![](.topwrite/assets/geo4.jpeg =774)
  * 区域统计分析：统计各服务区域内的门店分布情况 ![](.topwrite/assets/geo5.jpeg =757)

> **Esri Geometry**：**esri-geometry-api** 和 **spatial-sdk-hive** 是 Esri 公司开源的地理计算库，在大数据领域应用极其广泛。
>
> **核心优势**：
>
> * **行业标准**：Esri 作为 GIS 领导者，其几何算法库已成为事实标准
> * **功能完整**：支持 OGC 全部标准，包括点、线、面等几何类型及空间运算
> * **应用场景**：物流配送、LBS 服务、商圈分析、城市规划
>
> 通过集成 Esri 公司开源的地理计算库，Lakehouse 提供了标准化的地理数据处理能力

## 前置条件

* Lakehouse 环境已就绪
* 具有创建外部函数和 API CONNECTION 的权限

## 第一步：准备 JAR 包

### 1.1 下载所需 JAR 包

从 Esri 官方仓库下载以下两个 JAR 包：

```
# ESRI Geometry API
wget https://github.com/Esri/geometry-api-java/releases/download/v2.2.0/esri-geometry-api-2.2.0.jar

# Spatial Framework for Hadoop
wget https://github.com/Esri/spatial-framework-for-hadoop/releases/download/v2.2.0/spatial-sdk-hive-2.2.0.jar
```

### 1.2 上传 JAR 包到 USER VOLUME

将下载的 JAR 包上传到 Lakehouse 的 USER VOLUME（上传操作仅支持在 Lakehouse 客户端（如 [SQLLine](connect-with-cli.md)）中执行，不支持在 Lakehouse Studio 中执行）：

```
PUT '/Users/derekmeng/Downloads/esri-geometry-api-2.2.0.jar' to USER VOLUME;
PUT '/Users/derekmeng/Downloads/spatial-sdk-hive-2.2.0.jar' to USER VOLUME;
```

## 第二步：创建 API Connection

如果还没有合适的 API Connection，需要先创建一个。本例使用阿里云函数计算，详细步骤请参考：[创建 API CONNECTION](create-api-connection.md)

```
CREATE API CONNECTION fc_api_conn
TYPE cloud_function
  provider = 'aliyun'
  region = 'cn-shanghai'
  role_arn = 'acs:ram::122280886xxxxxxx:role/functionrole'
  namespace = 'default'
  code_bucket = '[bucket_name]';
```

可以通过 `show connections` 查看连接。

## 第三步：批量创建地理信息函数

### 3.1 创建常用的地理信息函数

以下是生产环境中最常用的地理信息函数创建脚本，详细信息请参考创建外部函数（[CREATE EXTERNAL FUNCTION](CREATE_EXTERNATL_FUNCTION.md)）：

```
-- ========================================
-- 1. 几何体构造函数
-- ========================================

-- 创建点
CREATE EXTERNAL FUNCTION public.ST_Point AS 'com.esri.hadoop.hive.ST_Point' 
USING jar 'volume:user://~/esri-geometry-api-2.2.0.jar', 
      jar 'volume:user://~/spatial-sdk-hive-2.2.0.jar' 
CONNECTION sg_fc_api_conn 
WITH PROPERTIES ( 
    'remote.udf.api' = 'java8.hive2.v0', 
    'remote.udf.protocol' = 'http.arrow.v0' 
);

-- 创建多边形
CREATE EXTERNAL FUNCTION public.ST_Polygon AS 'com.esri.hadoop.hive.ST_Polygon' 
USING jar 'volume:user://~/esri-geometry-api-2.2.0.jar', 
      jar 'volume:user://~/spatial-sdk-hive-2.2.0.jar' 
CONNECTION sg_fc_api_conn 
WITH PROPERTIES ( 
    'remote.udf.api' = 'java8.hive2.v0', 
    'remote.udf.protocol' = 'http.arrow.v0' 
);

-- 创建线
CREATE EXTERNAL FUNCTION public.ST_LineString AS 'com.esri.hadoop.hive.ST_LineString' 
USING jar 'volume:user://~/esri-geometry-api-2.2.0.jar', 
      jar 'volume:user://~/spatial-sdk-hive-2.2.0.jar' 
CONNECTION sg_fc_api_conn 
WITH PROPERTIES ( 
    'remote.udf.api' = 'java8.hive2.v0', 
    'remote.udf.protocol' = 'http.arrow.v0' 
);

-- ========================================
-- 2. 格式转换函数
-- ========================================

-- 从 WKT 文本创建几何体（最常用）
CREATE EXTERNAL FUNCTION public.ST_GeomFromText AS 'com.esri.hadoop.hive.ST_GeomFromText' 
USING jar 'volume:user://~/esri-geometry-api-2.2.0.jar', 
      jar 'volume:user://~/spatial-sdk-hive-2.2.0.jar' 
CONNECTION sg_fc_api_conn 
WITH PROPERTIES ( 
    'remote.udf.api' = 'java8.hive2.v0', 
    'remote.udf.protocol' = 'http.arrow.v0' 
);

-- 转换为 WKT 文本
CREATE EXTERNAL FUNCTION public.ST_AsText AS 'com.esri.hadoop.hive.ST_AsText' 
USING jar 'volume:user://~/esri-geometry-api-2.2.0.jar', 
      jar 'volume:user://~/spatial-sdk-hive-2.2.0.jar' 
CONNECTION sg_fc_api_conn 
WITH PROPERTIES ( 
    'remote.udf.api' = 'java8.hive2.v0', 
    'remote.udf.protocol' = 'http.arrow.v0' 
);

-- 从 GeoJSON 创建几何体
CREATE EXTERNAL FUNCTION public.ST_GeomFromGeoJSON AS 'com.esri.hadoop.hive.ST_GeomFromGeoJson' 
USING jar 'volume:user://~/esri-geometry-api-2.2.0.jar', 
      jar 'volume:user://~/spatial-sdk-hive-2.2.0.jar' 
CONNECTION sg_fc_api_conn 
WITH PROPERTIES ( 
    'remote.udf.api' = 'java8.hive2.v0', 
    'remote.udf.protocol' = 'http.arrow.v0' 
);

-- ========================================
-- 3. 空间关系判断函数（生产环境核心函数）
-- ========================================

-- 包含关系（最常用于地理围栏）
CREATE EXTERNAL FUNCTION public.ST_Contains AS 'com.esri.hadoop.hive.ST_Contains' 
USING jar 'volume:user://~/esri-geometry-api-2.2.0.jar', 
      jar 'volume:user://~/spatial-sdk-hive-2.2.0.jar' 
CONNECTION sg_fc_api_conn 
WITH PROPERTIES ( 
    'remote.udf.api' = 'java8.hive2.v0', 
    'remote.udf.protocol' = 'http.arrow.v0' 
);

-- 相交关系
CREATE EXTERNAL FUNCTION public.ST_Intersects AS 'com.esri.hadoop.hive.ST_Intersects' 
USING jar 'volume:user://~/esri-geometry-api-2.2.0.jar', 
      jar 'volume:user://~/spatial-sdk-hive-2.2.0.jar' 
CONNECTION sg_fc_api_conn 
WITH PROPERTIES ( 
    'remote.udf.api' = 'java8.hive2.v0', 
    'remote.udf.protocol' = 'http.arrow.v0' 
);

-- 在内部关系
CREATE EXTERNAL FUNCTION public.ST_Within AS 'com.esri.hadoop.hive.ST_Within' 
USING jar 'volume:user://~/esri-geometry-api-2.2.0.jar', 
      jar 'volume:user://~/spatial-sdk-hive-2.2.0.jar' 
CONNECTION sg_fc_api_conn 
WITH PROPERTIES ( 
    'remote.udf.api' = 'java8.hive2.v0', 
    'remote.udf.protocol' = 'http.arrow.v0' 
);

-- ========================================
-- 4. 空间运算函数
-- ========================================

-- 缓冲区（用于创建服务范围）
CREATE EXTERNAL FUNCTION public.ST_Buffer AS 'com.esri.hadoop.hive.ST_Buffer' 
USING jar 'volume:user://~/esri-geometry-api-2.2.0.jar', 
      jar 'volume:user://~/spatial-sdk-hive-2.2.0.jar' 
CONNECTION sg_fc_api_conn 
WITH PROPERTIES ( 
    'remote.udf.api' = 'java8.hive2.v0', 
    'remote.udf.protocol' = 'http.arrow.v0' 
);

-- 距离计算（用于最近邻查询）
CREATE EXTERNAL FUNCTION public.ST_Distance AS 'com.esri.hadoop.hive.ST_Distance' 
USING jar 'volume:user://~/esri-geometry-api-2.2.0.jar', 
      jar 'volume:user://~/spatial-sdk-hive-2.2.0.jar' 
CONNECTION sg_fc_api_conn 
WITH PROPERTIES ( 
    'remote.udf.api' = 'java8.hive2.v0', 
    'remote.udf.protocol' = 'http.arrow.v0' 
);

-- 面积计算
CREATE EXTERNAL FUNCTION public.ST_Area AS 'com.esri.hadoop.hive.ST_Area' 
USING jar 'volume:user://~/esri-geometry-api-2.2.0.jar', 
      jar 'volume:user://~/spatial-sdk-hive-2.2.0.jar' 
CONNECTION sg_fc_api_conn 
WITH PROPERTIES ( 
    'remote.udf.api' = 'java8.hive2.v0', 
    'remote.udf.protocol' = 'http.arrow.v0' 
);

-- ========================================
-- 5. 几何属性提取函数
-- ========================================

-- 提取点的 X 坐标（经度）
CREATE EXTERNAL FUNCTION public.ST_X AS 'com.esri.hadoop.hive.ST_X' 
USING jar 'volume:user://~/esri-geometry-api-2.2.0.jar', 
      jar 'volume:user://~/spatial-sdk-hive-2.2.0.jar' 
CONNECTION sg_fc_api_conn 
WITH PROPERTIES ( 
    'remote.udf.api' = 'java8.hive2.v0', 
    'remote.udf.protocol' = 'http.arrow.v0' 
);

-- 提取点的 Y 坐标（纬度）
CREATE EXTERNAL FUNCTION public.ST_Y AS 'com.esri.hadoop.hive.ST_Y' 
USING jar 'volume:user://~/esri-geometry-api-2.2.0.jar', 
      jar 'volume:user://~/spatial-sdk-hive-2.2.0.jar' 
CONNECTION sg_fc_api_conn 
WITH PROPERTIES ( 
    'remote.udf.api' = 'java8.hive2.v0', 
    'remote.udf.protocol' = 'http.arrow.v0' 
);

-- 查看已创建的地理信息函数
USE public;
SHOW EXTERNAL FUNCTIONS;


```

## 第四步：创建测试数据

为了验证函数功能，创建包含地理信息的测试表：

```
-- 创建门店位置表
CREATE TABLE IF NOT EXISTS store_locations (
    store_id INT,
    store_name STRING,
    location STRING,  -- WKT 格式的点
    city STRING,
    store_type STRING
);

-- 创建服务区域表
CREATE TABLE IF NOT EXISTS service_areas (
    area_id INT,
    area_name STRING,
    boundary STRING,  -- WKT 格式的多边形
    area_type STRING,
    city STRING
);

-- 插入示例门店数据
INSERT INTO store_locations VALUES 
(1, '北京王府井店', 'POINT(116.410 39.914)', '北京', '旗舰店'),
(2, '北京三里屯店', 'POINT(116.454 39.934)', '北京', '标准店'),
(3, '上海南京路店', 'POINT(121.473 31.232)', '上海', '旗舰店'),
(4, '上海徐家汇店', 'POINT(121.437 31.195)', '上海', '标准店'),
(5, '深圳华强北店', 'POINT(114.085 22.547)', '深圳', '标准店'),
(6, '深圳福田CBD店', 'POINT(114.059 22.536)', '深圳', '旗舰店'),
(7, '广州天河店', 'POINT(113.321 23.125)', '广州', '旗舰店'),
(8, '杭州西湖店', 'POINT(120.147 30.242)', '杭州', '标准店');

-- 插入示例服务区域数据
INSERT INTO service_areas VALUES 
(1, '北京核心商圈', 'POLYGON((116.38 39.88, 116.48 39.88, 116.48 39.96, 116.38 39.96, 116.38 39.88))', '核心区', '北京'),
(2, '上海市中心', 'POLYGON((121.43 31.18, 121.52 31.18, 121.52 31.26, 121.43 31.26, 121.43 31.18))', '核心区', '上海'),
(3, '深圳福田区', 'POLYGON((114.02 22.51, 114.13 22.51, 114.13 22.58, 114.02 22.58, 114.02 22.51))', '商业区', '深圳'),
(4, '配送范围A', 'POLYGON((116.35 39.85, 116.50 39.85, 116.50 39.98, 116.35 39.98, 116.35 39.85))', '配送区', '北京'),
(5, '配送范围B', 'POLYGON((121.40 31.15, 121.55 31.15, 121.55 31.28, 121.40 31.28, 121.40 31.15))', '配送区', '上海');
```

## 第五步：生产场景验证

### 场景 1：地理围栏分析——判断门店是否在服务区域内

这是最常见的应用场景，用于判断用户、门店或设备是否在指定的服务范围内。

```
-- 查询哪些门店在各个服务区域内
SELECT 
    s.store_name,
    s.city as store_city,
    a.area_name,
    a.area_type
FROM 
    store_locations s
    JOIN service_areas a
    ON public.ST_Contains(
        public.ST_GeomFromText(a.boundary), 
        public.ST_GeomFromText(s.location)
    ) = true
ORDER BY a.area_name, s.store_name;

-- 统计每个服务区域内的门店数量
SELECT 
    a.area_name,
    a.area_type,
    COUNT(s.store_id) as store_count,
    COLLECT_LIST(s.store_name) as stores_in_area
FROM 
    service_areas a
    LEFT JOIN store_locations s
    ON public.ST_Contains(
        public.ST_GeomFromText(a.boundary), 
        public.ST_GeomFromText(s.location)
    ) = true
GROUP BY a.area_name, a.area_type
ORDER BY store_count DESC;
```

### 场景 2：最近邻查询——查找最近的门店

用于为用户推荐最近的服务点，或进行资源分配。

```
-- 查找距离指定位置最近的3家门店
WITH user_location AS (
    SELECT public.ST_Point(116.397, 39.908) as location  -- 北京天安门位置
)
SELECT 
    s.store_name,
    s.city,
    s.store_type,
    public.ST_Distance(
        u.location,
        public.ST_GeomFromText(s.location)
    ) as distance_degrees,
    -- 粗略转换为公里（1度约等于111公里）
    public.ST_Distance(
        u.location,
        public.ST_GeomFromText(s.location)
    ) * 111 as distance_km
FROM 
    store_locations s
    CROSS JOIN user_location u
ORDER BY distance_degrees
LIMIT 3;
```

### 场景 3：缓冲区分析——创建配送范围

为每个门店创建配送范围，用于服务范围规划。

```
-- 为旗舰店创建5公里配送范围（约0.045度）
SELECT 
    store_name,
    city,
    location as original_location,
    public.ST_Buffer(
        public.ST_GeomFromText(location),
        0.045  -- 约5公里
    ) as delivery_area
FROM 
    store_locations
WHERE 
    store_type = '旗舰店';

-- 查询某个点是否在任意旗舰店的配送范围内
WITH delivery_zones AS (
    SELECT 
        store_name,
        public.ST_Buffer(
            public.ST_GeomFromText(location),
            0.045
        ) as delivery_area
    FROM 
        store_locations
    WHERE 
        store_type = '旗舰店'
),
test_point AS (
    SELECT public.ST_Point(116.420, 39.920) as location  -- 测试点
)
SELECT 
    d.store_name,
    CASE 
        WHEN public.ST_Contains(d.delivery_area, t.location) = true 
        THEN '在配送范围内'
        ELSE '不在配送范围内'
    END as delivery_status
FROM 
    delivery_zones d
    CROSS JOIN test_point t;
```

### 场景 4：区域统计分析

统计各个区域的业务指标，用于商业分析。

```
-- 创建销售数据表
CREATE TABLE IF NOT EXISTS store_sales (
    store_id INT,
    sales_amount DECIMAL(10,2),
    sales_date DATE
);

-- 插入示例销售数据
INSERT INTO store_sales VALUES 
(1, 125000.50, '2024-06-01'),
(2, 98000.00, '2024-06-01'),
(3, 156000.75, '2024-06-01'),
(4, 87000.25, '2024-06-01'),
(5, 76000.00, '2024-06-01'),
(6, 134000.80, '2024-06-01'),
(7, 145000.60, '2024-06-01'),
(8, 93000.40, '2024-06-01');

-- 按服务区域统计销售额
SELECT 
    a.area_name,
    a.area_type,
    COUNT(DISTINCT s.store_id) as store_count,
    SUM(sales.sales_amount) as total_sales,
    AVG(sales.sales_amount) as avg_sales_per_store
FROM 
    service_areas a
    LEFT JOIN store_locations s
    ON public.ST_Contains(
        public.ST_GeomFromText(a.boundary), 
        public.ST_GeomFromText(s.location)
    ) = true
    LEFT JOIN store_sales sales
    ON s.store_id = sales.store_id
GROUP BY a.area_name, a.area_type
ORDER BY total_sales DESC;
```

### 场景 5：坐标提取与转换

提取和转换坐标信息，用于与其他系统集成。

```
-- 提取所有门店的经纬度坐标
SELECT 
    store_id,
    store_name,
    city,
    public.ST_X(public.ST_GeomFromText(location)) as longitude,
    public.ST_Y(public.ST_GeomFromText(location)) as latitude,
    location as wkt_format
FROM 
    store_locations
ORDER BY city, store_name;

-- 创建点并立即提取坐标（用于数据验证）
SELECT 
    public.ST_X(public.ST_Point(116.397, 39.908)) as x_coord,
    public.ST_Y(public.ST_Point(116.397, 39.908)) as y_coord;
```

## 性能优化建议

### 1. 使用物化视图缓存几何体转换结果

```
-- 创建物化视图，预先转换 WKT 为二进制几何体
CREATE MATERIALIZED VIEW mv_store_locations AS
SELECT 
    store_id,
    store_name,
    location as location_wkt,
    public.ST_GeomFromText(location) as location_geom,
    city,
    store_type
FROM 
    store_locations;

-- 使用物化视图进行查询（性能更好）
SELECT 
    s.store_name,
    a.area_name
FROM 
    mv_store_locations s
    JOIN service_areas a
    ON public.ST_Contains(
        public.ST_GeomFromText(a.boundary), 
        s.location_geom
    ) = true;
```

### 2. 批量处理地理数据

```
-- 批量判断多个点是否在区域内
WITH test_points AS (
    SELECT 1 as id, 'POINT(116.400 39.910)' as location
    UNION ALL
    SELECT 2, 'POINT(121.470 31.230)'
    UNION ALL
    SELECT 3, 'POINT(114.060 22.540)'
)
SELECT 
    p.id,
    p.location,
    a.area_name,
    public.ST_Contains(
        public.ST_GeomFromText(a.boundary),
        public.ST_GeomFromText(p.location)
    ) as is_inside
FROM 
    test_points p
    CROSS JOIN service_areas a
WHERE 
    public.ST_Contains(
        public.ST_GeomFromText(a.boundary),
        public.ST_GeomFromText(p.location)
    ) = true;
```

## 注意事项

1.  **坐标系**：默认使用 WGS84 坐标系（经纬度），距离单位为度。

2.  **精度说明**：基于经纬度（WGS84）的距离计算是球面近似值，精确计算通常需要投影转换。

3.  **性能考虑**：
    * 大数据量查询时，可先用边界框（Envelope）进行粗筛。
    * 频繁使用的几何体转换结果建议缓存。
    * 复杂多边形运算比简单点运算消耗更多计算资源。

## 故障排查

### 常见错误及解决方案

1. **函数未找到错误**

   ```
   错误: function not found - ST_Contains解决: 使用 public.ST_Contains
   ```

2. **几何体格式错误**

   ```
   错误: Invalid WKT format ; 解决: 检查 WKT 格式是否正确，多边形必须闭合
   ```

3. **JAR 包路径错误**

   ```
   错误: Cannot find jar file, 解决: 使用 LIST USER VOLUME 确认文件路径
   ```

^
