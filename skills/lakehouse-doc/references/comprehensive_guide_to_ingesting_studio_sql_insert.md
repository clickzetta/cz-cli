# 将数据导入云器 Lakehouse 的完整指南

## 数据入仓：通过云器 Lakehouse Studio 以 SQL INSERT 方式导入数据

#### 概述

在云器 Lakehouse 平台中，用户可以使用 `INSERT` 语句将数据导入目标表。该语句支持多种导入方式，包括直接插入值、从其他表查询导入数据以及从外部文件导入数据。以下文档将详细介绍如何使用 `INSERT` 语句导入数据，以及其使用场景、操作示例和注意事项。

#### 方式一：使用`INSERT INTO VALUES`语句导入数据

##### 使用场景

适用于手动导入少量数据，用于调试与测试。对于大规模数据处理，通常建议采用批量插入、流式数据导入等更加高效的方法来确保数据导入过程的稳定性和性能。

##### 实现步骤

导航到 开发 -> 任务，单击 “+” 新建一个 SQL 任务（以下两种方式都在同一个任务里实现）。

![](.topwrite/assets/image_1736148597217.png =470)

您可以使用 `INSERT INTO VALUES` 语句直接插入数据。多个记录之间使用逗号分隔。

```SQL
--方式一：使用INSERT INTO SELECT FROM TABLE语句插入
DROP TABLE IF EXISTS ingest.lift_tuckets_import_by_insert_into_values;
CREATE TABLE IF NOT EXISTS ingest.lift_tuckets_import_by_insert_into_values(
  `txid` string,
  `rfid` string,
  `resort` string,
  `purchase_time` timestamp_ltz,
  `expiration_time` date,
  `days` int,
  `name` string,
  `address_street` string,
  `address_city` string,
  `address_state` string,
  `address_postalcode` string,
  `phone` string,
  `email` string,
  `emergency_contact_name` string,
  `emergency_contact_phone` string);

INSERT INTO ingest.lift_tuckets_import_by_insert_into_values (
  txid, rfid, resort, purchase_time, expiration_time, days, name, address_street, 
  address_city, address_state, address_postalcode, phone, email, emergency_contact_name, emergency_contact_phone
) VALUES
('0056b1f3-79b0-455c-80e9-3b80c45ac61e', '0x39eb22cbb32e9e115917b6', '长安壹号',
  timestamp_ltz '2023-08-30 12:00:00', TO_DATE('2025-03-12', 'yyyy-MM-dd'), 2, '佘雪梅', '广州路S座', 
  '艳市', '河北省', 853592, 13912709719, 'pchen@example.net', '林楠', 18041629236),
('52016065-1399-48cc-aed2-d4a525d90452', '0x121a00c15e41d8c3410c7490', '海底捞',
  timestamp_ltz '2023-08-30 12:00:00', TO_DATE('2025-10-16', 'yyyy-MM-dd'), 3, '韦超', '上海路R座', 
  '伟县', '香港特别行政区', 123342, 18259131600, 'panyan@example.net', '魏玉兰', 14795983190);
```

#### 方式二：使用`INSERT INTO SELECT`语句导入数据

##### 使用场景

如果需要从另一个表中导入数据，可以使用 `INSERT INTO SELECT` 语句。您可以选择导入整个表的数据，也可以进行 ETL 操作，如选择部分列或进行数据转换。

##### 实现步骤

导航到 开发 -> 任务，单击 “+” 新建一个 SQL 任务。

```SQL
--方式二：使用INSERT INTO SELECT FROM TABLE语句插入
DROP TABLE IF EXISTS ingest.lift_tuckets_import_by_insert_into_select;
CREATE TABLE IF NOT EXISTS ingest.lift_tuckets_import_by_insert_into_select(
  `txid` string,
  `rfid` string,
  `resort` string,
  `purchase_time` timestamp_ltz,
  `expiration_time` date,
  `days` int,
  `name` string,
  `address_street` string,
  `address_city` string,
  `address_state` string,
  `address_postalcode` string,
  `phone` string,
  `email` string,
  `emergency_contact_name` string,
  `emergency_contact_phone` string);
  
INSERT INTO ingest.lift_tuckets_import_by_insert_into_select
SELECT * FROM ingest.lift_tuckets_import_by_studio_web;
```

#### 方式三：从Volume文件查询数据并导入

##### 使用场景

云器 Lakehouse 支持通过 `INSERT INTO` 与 `SELECT FROM VOLUME` 结合使用，直接从外部文件（如云存储中的 CSV 或 Parquet 文件）导入数据。

注：在 ZettaPark 上传数据文件的案例中，已将 CSV、JSON 格式的数据文件上传至云器 Lakehouse 的数据湖对象 ingest_demo 中。

##### 实现步骤

导航到 开发 -> 任务，单击 “+” 新建一个 SQL 任务。

```SQL
DROP TABLE IF EXISTS ingest.lift_tuckets_import_by_insert_into_select_from_volume;
CREATE TABLE IF NOT EXISTS ingest.lift_tuckets_import_by_insert_into_select_from_volume(
  `txid` string,
  `rfid` string,
  `resort` string,
  `purchase_time` timestamp_ltz,
  `expiration_time` date,
  `days` int,
  `name` string,
  `address_street` string,
  `address_city` string,
  `address_state` string,
  `address_postalcode` string,
  `phone` string,
  `email` string,
  `emergency_contact_name` string,
  `emergency_contact_phone` string);


--使用SELECT文件的结果导入数据
--查看上传至Volume的数据文件
SHOW VOLUME  DIRECTORY ingest.ingest_demo;

--使用CSV格式数据文件导入
INSERT INTO ingest.lift_tuckets_import_by_insert_into_select_from_volume 
select * from volume ingest_demo(
  `txid` string,
  `rfid` string,
  `resort` string,
  `purchase_time` timestamp_ltz,
  `expiration_time` date,
  `days` int,
  `name` string,
  `address_street` string,
  `address_city` string,
  `address_state` string,
  `address_postalcode` string,
  `phone` string,
  `email` string,
  `emergency_contact_name` string,
  `emergency_contact_phone` string
) using csv
 options(
    'header'='true',
    'sep'=',',
    'compression' = 'gzip'
 ) files('gz/lift_tickets_data.csv.gz');
 
--使用JSON格式数据文件导入
INSERT INTO ingest.lift_tuckets_import_by_insert_into_select_from_volume  
select * from volume ingest_demo(
        `txid` string,
        `rfid` string,
        `resort` string,
        `purchase_time` timestamp_ltz,
        `expiration_time` date,
        `days` int,
        `name` string,
        `address_street` string,
        `address_city` string,
        `address_state` string,
        `address_postalcode` string,
        `phone` string,
        `email` string,
        `emergency_contact_name` string,
        `emergency_contact_phone` string
        ) using json
options(
'compression' = 'gzip'
) files('gz/lift_tickets_data.json.gz');
```

除 CSV、JSON 格式外，云器 Lakehouse 还支持通过 SELECT FROM VOLUME 方式查询 Parquet、ORC、BSON 等开放格式的数据并导入。

#### 资料

[SQL Insert Into](INSERT.md)

[Create Table As](CREATETABLE.md)
