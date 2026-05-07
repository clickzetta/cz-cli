# Quick Start with Copy Command

通过本实验，体验如何快速使用云器 Lakehouse 的 COPY 命令将本地 CSV 文件加载到表中，并进行最基本的数据探查和分析。

本实验代码运行在 [Zeppelin Notebook](eco_integration/Zeppelin.md)，附录部分提供了相关指导。此外，本实验代码也可以运行在本地的各种 [数据库管理工具](data-mamager-tool.md) 里（能够支持 COPY 命令访问本地文件）。

## 创建本实验所用的新的schema

```
CREATE SCHEMA IF NOT EXISTS lakehouse_demo_basic_features_schema;
USE SCHEMA lakehouse_demo_basic_features_schema;
```

## 创建表

```
--创建表
CREATE TABLE if not exists central_park_weather_observations (
  station_id STRING,
  station_name STRING,
  date DATE,
  precipitation DECIMAL,
  snow_depth DECIMAL,
  snowfall DECIMAL,
  max_temperature DECIMAL,
  min_temperature DECIMAL,
  average_wind_speed DECIMAL
);

```

## 加载数据-copy from file

```
--加载数据
set copy.csv.with.header=false;
set copy.csv.skip.header=true;
copy central_park_weather_observations from '/opt/data/central_park_weather.csv' ;
```

请下载 [central\_park\_weather.csv](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/sample_data/central_park_weather.csv)，点击“Download raw file”下载到本地，并修改上述代码中的目录 (/opt/data/) 为你所下载的目录。
然后验证数据是否已经加载成功：

```
select count(1) from central_park_weather_observations;
```

## 探查数据

```
SELECT * FROM central_park_weather_observations LIMIT 10;
```

## 分析数据

```
SELECT date, sum(precipitation) FROM central_park_weather_observations
GROUP BY date
ORDER BY date;
```

## 清理

```
DROP TABLE IF EXISTS central_park_weather_observations;
DROP SCHEMA IF EXISTS lakehouse_demo_basic_features_schema;
```

## 恭喜，任务完成！

请享受并继续学习！

## 附录

### 下载Zeppelin Notebook源文件

本文代码也提供运行在 [Zeppelin](eco_integration/Zeppelin.md) 的版本。如果你想直接运行本文代码，请按照文档说明安装 [Zeppelin](eco_integration/Zeppelin.md)。

[Quick Start with Copy command.ipynb](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/zeppelin_notebook/01.Quick%20Start%20with%20Copy%20command.ipynb)
