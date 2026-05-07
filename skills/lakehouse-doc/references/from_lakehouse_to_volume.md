# 导出数据到VOLUME -  COPY INTO VOLUME

**目标**：将一张表或一个查询结果导出为文件到 Volume 的指定路径下。

## 语法

```SQL
COPY INTO { VOLUME external_volume_name | TABLE VOLUME table_name  | USER VOLUME }  
SUBDIRECTORY '<path>'
FROM { [<namespace>.]<table_name> |(<query>)}
FILE_FORMAT = ( TYPE = { CSV|TEXT|PARQUET }  [ formatTypeOptions ]  ) 
[ copyOptions ]
```

### **参数说明**

* **formatTypeOptions**
  * COMPRESSION：可选参数。指定压缩格式，默认为不压缩。支持 GZIP、ZSTD、DEFLATE 压缩。例如：`COMPRESSION = 'GZIP'`

* **copyOptions**
  * filename_prefix = '\<prefex\_name>'：可选参数。设置文件前缀。例如：`filename_prefix = 'my_prefix_'`
  * filename_suffix = '\<suffix>'：可选参数。设置文件后缀。例如：`filename_suffix = '.data'`
  * include_job_id = 'TRUE' | 'FALSE'：可选参数。设置文件名是否包含作业 ID，不设置时默认为不包含。例如：`include_job_id = 'TRUE'`

## 使用示例

* 导出表数据到 Volume
  ```SQL
-- Unload to external volume
COPY INTO VOLUME my_external_vol SUBDIRECTORY 'dau_unload/' 
FROM TABLE dau
file_format = (type = CSV);

-- Unload to table volume
COPY INTO TABLE VOLUME dau SUBDIRECTORY 'dau_unload/' 
FROM TABLE dau
file_format = (type = CSV);

-- Unload to user volume
COPY INTO USER VOLUME SUBDIRECTORY 'dau_unload/' 
FROM TABLE dau
FILE_FORMAT = (TYPE = CSV )


SHOW VOLUME DIRECTORY my_external_vol;

relative_path                                   url                                                                size last_modified_time  
----------------------------------------------- ------------------------------------------------------------------ ---- ------------------- 
dau_unload/part00001.csv                           oss://your-bucket/dau_unload/part00001.csv                           75   2024-05-29 17:03:25 
```
* 导出查询结果到 Volume
  ```SQL
-- copy from query
COPY INTO VOLUME my_external_vol SUBDIRECTORY 'dau_unload/' 
FROM (SELECT * FROM DAU limit 5)
FILE_FORMAT = (type = CSV);
```
* 导出时设置文件格式
  ```SQL
-- copy from table to external volume
COPY INTO VOLUME my_external_vol SUBDIRECTORY 'dau_unload/' 
FROM TABLE dau
FILE_FORMAT = (type = CSV);

-- COPY_OPTION: Unload and compress with gzip
COPY INTO VOLUME my_external_vol SUBDIRECTORY 'dau_unload/' 
FROM (SELECT * FROM DAU limit 5)
FILE_FORMAT = (TYPE = CSV COMPRESSION = 'GZIP') ;

COPY INTO VOLUME my_external_vol SUBDIRECTORY 'dau/' 
FROM TABLE dau
FILE_FORMAT = (type = PARQUET COMPRESSION = 'GZIP');
```
* 导出时设置任务参数
  ```SQL
-- COPY_OPTION: Unload and add prefix to file names
COPY INTO VOLUME my_external_vol SUBDIRECTORY 'dau_unload/' 
FROM TABLE dau
FILE_FORMAT = (TYPE = CSV) 
FILENAME_PREFIX = 'my_prefix_';

-- COPY_OPTION: Unload and add suffix to file names
COPY INTO VOLUME my_external_vol SUBDIRECTORY 'dau_unload/' 
FROM TABLE dau
FILE_FORMAT = (TYPE = CSV) 
FILENAME_PREFIX = '.data';

-- COPY_OPTION: Unload and add job id to file names
COPY INTO VOLUME my_external_vol SUBDIRECTORY 'dau_unload/' 
FROM TABLE dau
FILE_FORMAT =  (TYPE = CSV )
INCLUDE_JOB_ID = 'TRUE';
```

## 约束与限制

* 要求 JDBC 驱动版本为 1.3.5 及以上。

