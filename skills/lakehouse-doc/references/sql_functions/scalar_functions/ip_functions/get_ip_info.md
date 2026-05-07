# GET\_IP\_INFO

# 函数概述

```python
 get_ip_info(string ip, string table, string column)
```

该函数会在运行时根据第二个参数的指定的表名自动加载IP信息库,该表要求至少有 start\_ip end\_ip列,表示IP范围的闭区间。返回结果为第三个参数指定的column列。

# **参数说明**

| 参数       | 类型     | 必填 | 说明                                         |
| -------- | ------ | -- | ------------------------------------------ |
| `ip`     | string | 是  | 待查询的IP地址（支持IPv4/IPv6格式）                    |
| `table`  | string | 是  | 指定Lakehouse表名字，且表结构需包含`start_ip`和`end_ip`列 |
| `column` | string | 是  | 需返回的目标字段名，STRING类型必须是第二个参数table中存在的字段      |

# **返回值**

* 匹配成功：返回指定`column`列的字段值（STRING类型）

# **使用示例**

## 示例1

1. 准备IP数据库表

```sql
CREATE TABLE IF NOT EXISTS ip_db(
  start_ip   STRING COMMENT 'IP段起始地址',
  end_ip     STRING COMMENT 'IP段结束地址',
  geoname_id STRING,
  country    STRING,
  city       STRING
);

INSERT OVERWRITE TABLE ip_db VALUES
  ("2a7:1c44:39f3:1b::", "2a7:1c44:39f3:1b:ffff:ffff:ffff:ffff", "8070", "USA", "LA"),
  ("2c0f:ffb8::", "2c0f:ffb8:ffff:fff:fff:ffff:ff:ffff", "37210", "CHINA", "BJ"),
  ("1.0.0.0", "1.0.0.255", "5987", "JAPAN", "TOKYO"),  -- 修正城市名拼写
  ("2.0.0.0", "2.0.0.255", "8026", "INDIA", "DELHI");  -- 修正国家名拼写
```

2. 执行查询

```sql
SELECT 
  ip, 
  get_ip_info(ip, 'ip_db', 'country') AS country
FROM VALUES
  ('2c0f:ffb8:1b::'),  -- IPv6
  ('1.0.0.2'),         -- IPv4
  ('3.0.0.0')          -- 无匹配
AS t(ip);
```

预期输出

| ip              | country |
| --------------- | ------- |
| 2c0f\:ffb8:1b:: | CHINA   |
| 1.0.0.2         | JAPAN   |
| 3.0.0.0         | NULL    |

***

## 示例2

### **一、业务背景**

需基于IP地址快速获取7维地理信息：

| 字段              | 说明     | 示例值           |
| --------------- | ------- | ------------- |
| `country`       | 国家名称  | 中国            |
| `province`      | 省级行政区 | 北京市           |
| `city`      | 城市名称  | 朝阳区           |
| `timezone`      | 时区信息  | Asia/Shanghai |
| `latitude`      | 纬度坐标  | 39.9042       |
| `longitude`     | 经度坐标  | 116.4074      |
| `countryCode`   | 国家代码  | CN            |
| `continentCode` | 大洲代码  | AS            |

### 二、技术实现

基于Lakehouse内置函数`get_ip_info(ip, table_name, column)`实现IP解析，底层采用ip2location技术方案。

### 三、实施流程

#### 1. 数据准备

* **下载官方数据包**
  访问[MaxMind官网](https://dev.maxmind.com/geoip/geoip2/geolite2/)获取最新版GeoLite2-City-CSV数据包（含IPv4/IPv6数据）

* **转换CIDR为IP段**
  使用官方转换工具生成可查询的IP范围：
  ```bash
  # 转换IPv4数据
  ./geoip2-csv-converter -block-file GeoLite2-City-Blocks-IPv4.csv \
    -include-range -output-file IPv4_Blocks_Converted.csv

  # 转换IPv6数据
  ./geoip2-csv-converter -block-file GeoLite2-City-Blocks-IPv6.csv \
    -include-range -output-file IPv6_Blocks_Converted.csv
  ```
  本文使用的是如下两个 CSV 文件，分别是网络 IP 地址段表和中国地理信息表：
  ![](../../../.topwrite/assets/image_1744721445413.png)

#### 2. 数据建模

##### (1) IP地址段表 `geoip`

```sql
CREATE TABLE geoip (
  network_start_ip  STRING  COMMENT 'IP段起始地址',
  network_last_ip   STRING  COMMENT 'IP段结束地址',
  geoname_id        STRING  COMMENT '地理位置ID',
  latitude          STRING  COMMENT '纬度',
  longitude         STRING  COMMENT '经度'
)
;
```

##### (2) 地理信息表 `geolocation`

```sql
CREATE TABLE geolocation (
  geoname_id        STRING  COMMENT '地理位置ID',
  country_code      STRING  COMMENT '国家代码(ISO 3166)',
  country           STRING  COMMENT '国家名称',
  province          STRING  COMMENT '省级行政区',
  city              STRING  COMMENT '城市名称',
  time_zone         STRING  COMMENT '时区',
  continent_code    STRING  COMMENT '大洲代码'
);
```

##### (3) 聚合视图表 `geo_lite_info`

```sql
-- 创建聚合表
CREATE TABLE geo_lite_info (
  start_ip          STRING  COMMENT 'IP段起始',
  end_ip            STRING  COMMENT 'IP段结束',
  country           STRING,
  province          STRING,
  city              STRING,
  timezone          STRING,
  latitude          STRING,
  longitude         STRING,
  country_code      STRING,
  continent_code    STRING
);

-- 数据关联写入
INSERT OVERWRITE TABLE geo_lite_info
SELECT 
  a.network_start_ip,
  a.network_last_ip,
  b.country,
  b.province,
  b.city,
  b.time_zone,
  a.latitude,
  a.longitude,
  b.country_code,
  b.continent_code
FROM geoip a
JOIN geolocation b 
  ON a.geoname_id = b.geoname_id;
```

***

### 四、函数调用

#### 前提条件

* 目标表`geo_lite_info`已正确创建且数据就绪
* IP地址需为规范化格式（支持IPv4/IPv6）

#### 调用示例

```sql
-- 单点查询
SELECT 
  get_ip_info('114.246.239.157', 'geo_lite_info', 'city') AS city,
  get_ip_info('2001:4860:4860::8888', 'geo_lite_info', 'timezone') AS tz;

-- 批量查询
SELECT 
  ip,
  get_ip_info(ip, 'geo_lite_info', 'country') AS country,
  get_ip_info(ip, 'geo_lite_info', 'province') AS province
FROM VALUES (('8.8.8.8'), ('114.114.114.114')) AS t(ip);
```


