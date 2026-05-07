# 使用COPY INTO导出文件

将表或查询结果导出到指定路径。您可以将一张表或查询结果导出为文件并保存到 Volume 的指定路径。请注意，如果指定路径下已存在同名文件，则该文件将会被覆盖。

注意事项

* **默认文件名**：Lakehouse 导出时，默认文件名是相同的。因此，如果您多次运行导出操作并且指定了相同的子目录（SUBDIRECTORY），新文件将覆盖上次导出的文件。
* **避免覆盖**：为了防止意外覆盖现有文件，请确保每次导出时使用唯一的文件名或子目录。

# 语法

```SQL
---语法
COPY INTO { VOLUME external_volume_name | TABLE VOLUME table_name  | USER VOLUME }  
SUBDIRECTORY '<path>'
FROM { [schema.]<table_name> | ( <query> ) }
FILE_FORMAT = ( TYPE = { CSV  | PARQUET | JSON }  [ formatTypeOptions ]  ) 
[ copyOptions ]
```

## **参数说明**

* **COPY INTO**：表示向目录中追加数据。

* **VOLUME**：支持 `external_volume_name`，具体介绍参考[Volume介绍](datalake_volume.md)。
  * `external_volume_name`：客户指定的外部存储位置，云器仅保留路径元信息。支持的存储产品有：阿里云 OSS、腾讯云 COS、亚马逊云 S3。创建过程可以参考[CONNECTION创建](Datalake_StorageConnection.md)和[VOLUME创建](datalake_volume_object.md)。
  * **Table Volume**：Lakehouse内部存储，与内表对象共同存储于指定Schema路径下。
  * **User Volume**：用户账号关联的文件存储区域，Workspace User默认对该区域具备管理权限。每个Workspace都默认拥有一个具备管理权限的User Volume。
    ```SQL
    --1.将数据导入到external_volume中。前提必须创建external_volume
    COPY INTO VOLUME my_volume SUBDIRECTORY 'dau_unload/'
    FROM TABLE birds
    file_format = (type = CSV);
    --查看volume中的文件
    --show volume directory
    SHOW VOLUME DIRECTORY my_volume SUBDIRECTORY 'dau_unload/';
    +--------------------------+----------------------------------------------------------------+------+---------------------+
    |      relative_path       |                              url                               | size | last_modified_time  |
    +--------------------------+----------------------------------------------------------------+------+---------------------+
    | dau_unload/part00001.csv | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.csv | 105  | 2024-12-27 16:49:01 |
    +--------------------------+----------------------------------------------------------------+------+---------------------+
    --2.将数据导入到user volume中
    COPY INTO USER VOLUME SUBDIRECTORY 'dau_unload/'
    FROM TABLE birds
    file_format = (type = CSV);
    SHOW  USER VOLUME DIRECTORY  SUBDIRECTORY 'dau_unload/';
    +--------------------------+-------------------------------------------------------------------------------------------------------------------+------+---------------------+
    |      relative_path       |                                                        url                                                        | size | last_modified_time  |
    +--------------------------+-------------------------------------------------------------------------------------------------------------------+------+---------------------+
    | dau_unload/part00001.csv | oss://lakehouse-hz-uat/86/workspaces/qingyun_6552637055735457988/internal_volume/user_13/dau_unload/part00001.csv | 105  | 2024-12-27 16:52:06 |
    +--------------------------+-------------------------------------------------------------------------------------------------------------------+------+---------------------+
    --删除user volume中的文件
    REMOVE  VOLUME my_volume  FILE 'dau_unload/part00001.csv'

    --3.将数据导入到table volume中
    COPY INTO TABLE VOLUME birds  SUBDIRECTORY 'dau_unload/'
    FROM TABLE birds
    file_format = (type = CSV);
    SHOW  TABLE VOLUME  DIRECTORY  birds SUBDIRECTORY 'dau_unload/';
    +--------------------------+-------------------------------------------------------------------------------------------------------------------------------------+------+---------------------+
    |      relative_path       |                                                                 url                                                                 | size | last_modified_time  |
    +--------------------------+-------------------------------------------------------------------------------------------------------------------------------------+------+---------------------+
    | dau_unload/part00001.csv | oss://lakehouse-hz-uat/86/workspaces/qingyun_6552637055735457988/internal_volume/table_6808843871866704121/dau_unload/part00001.csv | 105  | 2024-12-27 16:57:54 |
    +--------------------------+-------------------------------------------------------------------------------------------------------------------------------------+------+---------------------+
    --删除table volume中的文件
    REMOVE TABLE VOLUME birds  FILE 'dau_unload/part00001.csv';
    ```

***

* **SUBDIRECTORY**：指定子路径，该参数必须填写。例如：`subdirectory 'month=02'`

* **FROM**：支持直接导出表中数据，或直接编写查询语句（query）。

```SQL
 --直接指定表
 COPY INTO VOLUME my_volume SUBDIRECTORY 'dau_unload/'
 FROM TABLE birds
 file_format = (type = CSV);
 --将SQL结果集导出
 COPY INTO VOLUME my_volume SUBDIRECTORY 'dau_unload/'
 FROM  (select * from birds limit 1)
 file_format = (type = CSV);
```

* **formatTypeOptions**：文件格式，支持 CSV、TEXT、PARQUET、JSON。其中 JSON 导出的格式参考 [JSON LINE](https://jsonlines.org/)。

* CSV 格式支持的参数：
  * sep：列分隔符，默认为 ”,“。最多支持长度为 1 的字符，例如：`sep=','`
  * compression：配置文件压缩格式。支持的压缩格式有：gzip/zstd/zlib。例如：`compression='gzip'`
  * lineSep：行分隔符，默认值为"\n"。最多支持长度为 2 的字符，例如：`lineSep='$'`
  * quote：设置用于转义引号值的单个字符。默认值为双引号“"”，例如：`quote='"'`
  * header：是否解析表头，默认为 false。布尔类型，例如：`header='true'`
  * timeZone：配置时区，没有默认值。用于指定文件中时间格式的时区。例如：`timeZone = 'Asia/Shanghai'`
  * escape：用于转义已加引号的值中的引号，默认值为“\”，例如：`escape='\'`
  * nullValue：用于判定什么样的内容应为 Null，默认值为 \`""\`，例如 `nullValue='\\\N'` 或者 `nullValue=r'\N'`。使用 `r` 可以不需要转义字符，参考[正则转译](regexp-statement.md)。
  * multiLine：是否有跨行的 CSV 记录，默认值为 `false`。如果有这样的记录，需要配置 `multiLine='true'`。
  ```SQL
  --指定分隔符为｜和压缩
  COPY INTO VOLUME my_volume  SUBDIRECTORY 'dau_unload/'
  FROM TABLE birds
  file_format = (
      type= CSV
      sep='|'
      compression='gzip'
  );
  ```

* JSON 格式支持的参数：
  * compression：源文件/目标文件是否压缩，默认不压缩，配置如 `'compression'='gzip'`

  ```SQL
    COPY INTO VOLUME my_volume  SUBDIRECTORY 'dau_unload/'
    FROM TABLE birds
    file_format = (
        type= json
    );
    ```

* Parquet、ORC、BSON 格式：无

  ```SQL
  COPY INTO VOLUME my_volume  SUBDIRECTORY 'dau_unload/'
  FROM TABLE birds
  file_format = (
      type= parquet
  );
  ```

* **copyOptions**

  * `filename_prefix = '\<prefix\_name>'`：可选参数。设置文件前缀，例如：`filename_prefix = 'my_prefix_'`

  ```SQL
   --给文件添加前缀
   COPY INTO VOLUME my_volume  SUBDIRECTORY 'dau_unload/'
   FROM TABLE birds
   file_format = (
       type= json
     
   )
   filename_prefix='birds'
   ;
   --查看目录，如第一行添加了前缀birds
   SHOW VOLUME DIRECTORY my_volume SUBDIRECTORY 'dau_unload/';

   +-------------------------------+---------------------------------------------------------------------+------+---------------------+
   |         relative_path         |                                 url                                 | size | last_modified_time  |
   +-------------------------------+---------------------------------------------------------------------+------+---------------------+
   | dau_unload/birds00001.json    | oss://lakehouse-perf-test/test_insert/dau_unload/birds00001.json    | 295  | 2024-12-27 17:29:20 |
   | dau_unload/part00001.csv      | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.csv      | 105  | 2024-12-27 17:15:40 |
   | dau_unload/part00001.csv.gzip | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.csv.gzip | 104  | 2024-12-27 17:19:33 |
   | dau_unload/part00001.json     | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.json     | 295  | 2024-12-27 17:24:26 |
   | dau_unload/part00001.parquet  | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.parquet  | 1886 | 2024-12-27 17:27:15 |
   | dau_unload/part00001.text     | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.text     | 87   | 2024-12-27 17:25:34 |
   +-------------------------------+---------------------------------------------------------------------+------+---------------------+
  ```

  * `filename_suffix = '\<suffix>'`：参数。设置文件后缀，例如：`filename_suffix = '.data'`

  ```SQL
        --添加后缀
        COPY INTO VOLUME my_volume  SUBDIRECTORY 'dau_unload/'
        FROM TABLE birds
        file_format = (
            type= json
          
        )
        filename_suffix='.data';
        --查看目录，如第四行添加了前缀birds
        SHOW VOLUME DIRECTORY my_volume SUBDIRECTORY 'dau_unload/';
        +-------------------------------+---------------------------------------------------------------------+------+---------------------+
        |         relative_path         |                                 url                                 | size | last_modified_time  |
        +-------------------------------+---------------------------------------------------------------------+------+---------------------+
        | dau_unload/birds00001.json    | oss://lakehouse-perf-test/test_insert/dau_unload/birds00001.json    | 295  | 2024-12-27 17:29:20 |
        | dau_unload/part00001.csv      | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.csv      | 105  | 2024-12-27 17:15:40 |
        | dau_unload/part00001.csv.gzip | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.csv.gzip | 104  | 2024-12-27 17:19:33 |
        | dau_unload/part00001.data     | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.data     | 295  | 2024-12-27 17:33:49 |
        | dau_unload/part00001.json     | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.json     | 295  | 2024-12-27 17:24:26 |
        | dau_unload/part00001.parquet  | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.parquet  | 1886 | 2024-12-27 17:27:15 |
        | dau_unload/part00001.text     | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.text     | 87   | 2024-12-27 17:25:34 |
        +-------------------------------+---------------------------------------------------------------------+------+---------------------+
  ```

  * `include_job_id = 'TRUE' | 'FALSE'`：可选参数。设置文件名是否写入作业ID，不设置时默认为不写入作业ID。例如：`include_job_id = 'TRUE'`

  ```
  --导出的文件包含jobid
  COPY INTO VOLUME my_volume  SUBDIRECTORY 'dau_unload/'
  FROM TABLE birds
  file_format = (
      type= json
    
  )
  include_job_id = 'TRUE' ;
  --查看目录，如第8行包含了导出的文件包含了jobid
  +--------------------------------------------------------+----------------------------------------------------------------------------------------------+------+---------------------+
  |                     relative_path                      |                                             url                                              | size | last_modified_time  |
  +--------------------------------------------------------+----------------------------------------------------------------------------------------------+------+---------------------+
  | dau_unload/birds00001.json                             | oss://lakehouse-perf-test/test_insert/dau_unload/birds00001.json                             | 295  | 2024-12-27 17:29:20 |
  | dau_unload/part00001.csv                               | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.csv                               | 105  | 2024-12-27 17:15:40 |
  | dau_unload/part00001.csv.gzip                          | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.csv.gzip                          | 104  | 2024-12-27 17:19:33 |
  | dau_unload/part00001.data                              | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.data                              | 295  | 2024-12-27 17:33:49 |
  | dau_unload/part00001.json                              | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.json                              | 295  | 2024-12-27 17:24:26 |
  | dau_unload/part00001.parquet                           | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.parquet                           | 1886 | 2024-12-27 17:27:15 |
  | dau_unload/part00001.text                              | oss://lakehouse-perf-test/test_insert/dau_unload/part00001.text                              | 87   | 2024-12-27 17:25:34 |
  | dau_unload/part202412271736045501gmspelya5o900001.json | oss://lakehouse-perf-test/test_insert/dau_unload/part202412271736045501gmspelya5o900001.json | 295  | 2024-12-27 17:36:04 |
  +--------------------------------------------------------+----------------------------------------------------------------------------------------------+------+---------------------+
  ```

# 使用示例

导出数据到user volume中

```SQL
CREATE TABLE birds (
    id INT,
    name VARCHAR(50),
    wingspan_cm FLOAT,
    colors STRING
);
INSERT INTO birds (id, name, wingspan_cm, colors) VALUES
    (1, 'Sparrow', 15.5, 'Brown'),
    (2, 'Blue Jay', 20.2, 'Blue'),
    (3, 'Cardinal', 22.1, 'Red'),
    (4, 'Robin', 18.7, 'Red","Brown');

COPY INTO USER VOLUME SUBDIRECTORY 'dau_unload/'
FROM TABLE birds
file_format = (type = CSV);
--查看是否导出成功
SHOW  USER VOLUME DIRECTORY  SUBDIRECTORY 'dau_unload/';
--删除文件避免占用存储
REMOVE  VOLUME my_volume  FILE 'dau_unload/part00001.csv';
```

导出数据到table volume中

```SQL
CREATE TABLE birds (
    id INT,
    name VARCHAR(50),
    wingspan_cm FLOAT,
    colors STRING
);
INSERT INTO birds (id, name, wingspan_cm, colors) VALUES
    (1, 'Sparrow', 15.5, 'Brown'),
    (2, 'Blue Jay', 20.2, 'Blue'),
    (3, 'Cardinal', 22.1, 'Red'),
    (4, 'Robin', 18.7, 'Red","Brown');
COPY INTO TABLE VOLUME birds  SUBDIRECTORY 'dau_unload/'
FROM TABLE birds
file_format = (type = CSV);
--查看是否导出成功
SHOW  TABLE VOLUME  DIRECTORY  birds SUBDIRECTORY 'dau_unload/';
--删除文件避免占用存储
REMOVE  TABLE  VOLUME birds  FILE 'dau_unload/part00001.csv';
```

导出到外部 Volume 中使用前提需要创建 VOLUME 和 CONNECTION。创建过程可以参考[CONNECTION创建](Datalake_StorageConnection.md)和[VOLUME创建](datalake_volume_object.md)。

导出数据到 OSS 中

```SQL
--创建表
CREATE TABLE birds (
    id INT,
    name VARCHAR(50),
    wingspan_cm FLOAT,
    colors STRING
);
INSERT INTO birds (id, name, wingspan_cm, colors) VALUES
    (1, 'Sparrow', 15.5, 'Brown'),
    (2, 'Blue Jay', 20.2, 'Blue'),
    (3, 'Cardinal', 22.1, 'Red'),
    (4, 'Robin', 18.7, 'Red","Brown');
--创建oss conenction
CREATE STORAGE CONNECTION  catalog_storage_oss
    type OSS
    ACCESS_ID='xxxx'
    ACCESS_KEY='xxxxxxx'
    ENDPOINT='oss-cn-hangzhou-internal.aliyuncs.com';
--创建volume
CREATE EXTERNAL VOLUME my_volume
    location 'oss://mybucket/test_insert/'
    using connection catalog_storage_oss
    directory = (
        enable=true,
        auto_refresh=true
    );
--将数据导出到test_insert子目录下
COPY INTO VOLUME my_volume SUBDIRECTORY 'dau_unload/'
FROM TABLE birds
file_format = (type = CSV);

```

导出数据到 COS 中

```SQL
--创建表
CREATE TABLE birds (
    id INT,
    name VARCHAR(50),
    wingspan_cm FLOAT,
    colors STRING
);
INSERT INTO birds (id, name, wingspan_cm, colors) VALUES
    (1, 'Sparrow', 15.5, 'Brown'),
    (2, 'Blue Jay', 20.2, 'Blue'),
    (3, 'Cardinal', 22.1, 'Red'),
    (4, 'Robin', 18.7, 'Red","Brown');
--创建cos conenction
CREATE STORAGE CONNECTION my_conn 
  TYPE COS
  ACCESS_KEY = '<access_key>'
  SECRET_KEY = '<secret_key>'
  REGION = 'ap-shanghai'
  APP_ID = '1310000503';
--创建volume
CREATE EXTERNAL VOLUME my_volume
    location 'cos://mybucket/test_insert/'
    using connection my_conn
    directory = (
        enable=true,
        auto_refresh=true
    );
--将数据导出到test_insert子目录下
COPY INTO VOLUME my_volume SUBDIRECTORY 'dau_unload/'
FROM TABLE birds
file_format = (type = CSV);

```

导出数据到 S3 中

```SQL
--创建表
CREATE TABLE birds (
    id INT,
    name VARCHAR(50),
    wingspan_cm FLOAT,
    colors STRING
);
INSERT INTO birds (id, name, wingspan_cm, colors) VALUES
    (1, 'Sparrow', 15.5, 'Brown'),
    (2, 'Blue Jay', 20.2, 'Blue'),
    (3, 'Cardinal', 22.1, 'Red'),
    (4, 'Robin', 18.7, 'Red","Brown');
--创建s3 conenction
CREATE STORAGE CONNECTION aws_bj_conn
    TYPE S3
    ACCESS_KEY = 'AKIAQNBSBP6EIJE33***'
    SECRET_KEY = '7kfheDrmq***************************'
    ENDPOINT = 's3.cn-north-1.amazonaws.com.cn'
    REGION = 'cn-north-1';
--创建volume
CREATE EXTERNAL VOLUME my_volume
    location 's3://mybucket/test_insert/'
    using connection aws_bj_conn
    directory = (
        enable=true,
        auto_refresh=true
    );
--将数据导出到test_insert子目录下
COPY INTO VOLUME my_volume SUBDIRECTORY 'dau_unload/'
FROM TABLE birds
file_format = (type = CSV);
```

^
