# 功能描述

将数据从对象存储中的文件加载到表中。这些文件必须存在于对象存储中。

* 目前支持的对象存储位置为腾讯云COS、阿里云OSS和AWS S3。当前只支持 Volume 对象存储
* 目前不支持跨云厂商导入。比如您的Lakehouse开服在阿里云而对象存储是腾讯云

# 语法

```SQL
--直接从VOLUME中导入数据
COPY INTO|OVERWRITE table_name
 [PARTITION (partition_column_name = partition_column_val)]
FROM VOLUME volume_name
[( <column_name> <column_type>,...) ]
USING CSV | PARQUET | ORC | BSON
OPTIONS(
  FileFormatParams
) 
FILES('filename1','fiename2'...)|SUBDIRECTORY 'path'|REGEXP <pattern>
PURGE=TRUE
ON_ERROR=TRUE|ABORT;

--导入过程中进行转化
COPY INTO table_name FROM (
SELECT  <column_name>,... 
FROM VOLUME <volume_name>
[(<column_name> <column_type>,...) ]
USING CSV|PARQUET|ORC 
OPTIONS(
  FileFormatParams
) 
FILES|SUBDIRECTORY|REGEXP <pattern>
)
PURGE=TRUE
ON_ERROR=CONTINUE|ABORT;
```

### 使用说明

COPY INTO 语句后面可以直接使用 VOLUME 查询语法，可以在导入过程中直接转换数据，VOLUME 查询[参考结构化、半结构化数据分析](structure_data_analysis.md)

### **参数说明**：

* **OVERWRITE**\|**INTO**:
  * **INTO**：追加模式。使用 `INTO` 子句进行数据导入时，新数据将被追加到目标表，这种模式不会删除或修改表中的现有数据。
  * **OVERWRITE**：覆盖模式。使用 `OVERWRITE` 子句进行数据导入时，目标表中的现有数据将被清空，然后导入新数据。这种模式适用于需要用新数据完全替换旧数据的场景。

```
--向表中追加数据
CREATE TABLE birds (
    id INT,
    name VARCHAR(50),
    wingspan_cm FLOAT,
    colors STRING
);
COPY INTO birds FROM 
VOLUME  my_volume
USING csv
SUBDIRECTORY 'dau_unload/read/';
--覆盖表中的的数据
COPY OVERWRITE birds FROM 
VOLUME  my_volume
USING csv
SUBDIRECTORY 'dau_unload/read/';
```
-  [PARTITION (partition_column_name = partition_column_val)],直接指定分区列的值，例如 `PARTITION (dt='shanghai')`。
* **column\_name**和**column\_type**：可选，lakehouse支持自动识别文件schema。推荐不填写。当指定文件中包含的列名和类型时，需与文件中预定义的列类型相匹配，
  * 自动识别文件 schema 对于 CSV 文件则会自动生成字段，字段编号以 f0 开始。目前自动识别的类型为 int、double、string、bool。
  * 对于parquet、orc格式将会根据文件中存储的字段名和类型自动识别。如果指定的文件中列的个数不一致，LakeHouse 会尝试合并，无法合并则会报错。
  ```
  --指定volume中的列类型和名字
  COPY OVERWRITE birds FROM 
  VOLUME  my_volume(id int,name string,wingspan_cm float,colors string)
  USING csv
  SUBDIRECTORY 'dau_unload/read/';
  --自动探查volume中的列类型和名字
  COPY OVERWRITE birds FROM 
  VOLUME  my_volume
  USING csv
  SUBDIRECTORY 'dau_unload/read/';
  ```
* **FileFormatParams**：多个参数使用逗号分隔，字符串形式的'key'='value'
    * CSV 格式：支持以下文件参数组合
      * sep：列分隔符，默认为 ”,“。最多支持长度为 2 的字符，例如：`'sep'=','`、`sep='||'`或者`sep = '\001'`：使用 Hive 默认的字段分隔符（不可见字符）
      * compression：配置文件压缩格式。支持的压缩格式有：gzip/zstd/zlib。例如：`'compression'='gzip'`
      * lineSep：行分隔符，默认会将 `\r\n` 与 `\n` 都识别为换行。最多支持长度为 2 的字符，例如：`'lineSep'='$'`使用 `$` 作为行分隔符。`lineSep = '\r\n'`使用 Windows 风格的换行符
      * quote：用于包裹包含特殊字符的字段内容，避免解析错误。默认值为双引号 "，当字段内容包含默认引用符（"）时必须指定。
        例如：导入数据为 `{"key":"value"}` 这类含双引号的 JSON 字符串时，需改用其他字符包裹，例如指定 `quote = r'\0'`，空字符`\0`方案需确保数据中不存在该字符。
      * header：是否解析表头，默认为 false。布尔类型，例如：`'header'='true'`
      * timeZone：配置时区，没有默认值。用于指定文件中时间格式的时区。例如：`'timeZone' = 'Asia/Shanghai'`
      * escape：用于转义已加引号的值中的特殊字符，仅支持单字节字符。默认值为”\“，例如：`'escape'=r'\'`。转义字符用于解释数据文件中字段分隔符或换行符的特殊含义。如果某一行以反斜杠结尾，则该反斜杠会转义文件格式选项中指定的换行符或回车符（`lineSep`）。因此，加载操作会将此行和下一行视为一行数据。如果不需要这种转义行为，可以将转义字符设置为其他字符
      * nullValue: 用于判定什么样的内容应该被视为 Null，默认值为 \`""\`，例如 \`'nullValue'='\\\N'\` 或者 \`'nullValue'=r'\N'\`。为了避免在不确定何时需要转义的情况下手动处理转义字符，Lakehouse 支持在字符串前添加 `r` 前缀，表示字符串中的转义字符不会被转义，可以直接输入到表达式中运行。
       * multiLine: 是否有跨行的 csv 记录，默认值为 `false`，如果有这样的记录，需要配置 `multiLine='true'`
    
    
    ```
    --指定分隔符和quote
    COPY OVERWRITE birds FROM 
    VOLUME  my_volume
    USING csv
    OPTIONS('sep'='|','quote'='"')
    files('dau_unload/part00001.csv');
    ```
    
    * JSON格式:
      * compression: 源文件/目标文件是否压缩，默认不压缩，配置如 `'compression'='gzip'`
      ```
      --导入json数据
      COPY OVERWRITE birds FROM 
      VOLUME  my_volume
      USING json
      files('dau_unload/part00001.json');
      ```
        * explodeArray：默认值 true， 可选值 false。在 JSON 内容是数组开头时使用。为 true 时认为 schema 是数组内单个元素的 schema，为 false 时认为 schema 是数组本身的 schema。
    * Parquet , ORC , BSON 格式
    * ```
      --导入parquet数据
      COPY OVERWRITE birds FROM 
      VOLUME  my_volume
      USING parquet
      files('dau_unload/part00001.parquet');
      ```

* **FILES**：用于指定要读取的具体文件。支持指定多个相同格式的文件。文件路径为创建 Volume 时指定的子文件路径。` `例如：`files('part-00002.snappy.parquet','part-00003.snappy.parquet')`。
* **SUBDIRECTORY**：指定子路径。用于指定要读取的子路径。读取时会递归地加载该目录下的所有文件。例如：`subdirectory 'month=02'。`
* ```
  COPY OVERWRITE birds FROM 
  VOLUME  my_volume(id int,name string,wingspan_cm float,colors string)
  USING csv
  SUBDIRECTORY 'dau_unload/read/';
  ```
* **REGEXP**\<pattern>：正则表达式匹配。正则路径匹配基于url，您可通过`SHOW VOLUME DIRECTORY my_tx_volume;`命令查看url。例如，`regexp 'part-.*.parquet'`可匹配以“part-”开头且以“.parquet”结尾的文件。需要注意的是，正则表达式匹配的目标是文件的**完整的对象存储路径**（如 's3://cz-udf-user/volume-data/1234321.csv.gz'），而不是文件在 Volume 对象中的相对路径。

* **PURGE=TRUE**：当设置此参数时，表示在数据导入成功后，将删除对象存储中的源文件。这有助于节省存储空间，特别是在处理大量数据时。如果导入操作失败，源文件将不会被删除。
* **ON_ERROR=CONTINUE|ABORT**:控制当数据加载过程中遇到错误时的处理策略。添加此参数后，会返回导入文件列表。
  * `CONTINUE`：跳过错误行，继续加载后续数据。使用场景：容忍部分错误，要求最大限度完成数据加载。目前忽略的错误只支持文件格式不匹配，例如命令中指定的是 zip 压缩格式但文件中实际是 zstd 压缩。
  * `ABORT`：立即终止整个 COPY 操作。使用场景：严格数据质量要求场景，任何错误都需人工介入检查

    ```
    --指定abort参数
    copy into test_data from volume on_error_pipe  using csv OPTIONS(sep='|','quote'='\0')
    on_error = 'abort';
    +-------------------------------------------------+---------+-------------+-------------+
    |                      file                       | status  | rows_loaded | first_error |
    +-------------------------------------------------+---------+-------------+-------------+
    | oss://lakehouse-perf-test/tmp/tmp_pipe/copy.csv | SUCCESS | 2           |             |
    +-------------------------------------------------+---------+-------------+-------------+
    --指定continue参数
    copy into test_data from volume on_error_pipe  using csv OPTIONS(sep='|','quote'='\0')
    on_error = 'continue';
    +-----------------------------------------------------+---------------+-------------+----------------------------------------------------------------------------------------------------------------------+
    |                        file                         |    status     | rows_loaded |                                                                first_error                                           |
    +-----------------------------------------------------+---------------+-------------+----------------------------------------------------------------------------------------------------------------------+
    | oss://lakehouse-perf-test/tmp/tmp_pipe/copy.csv     | SUCCESS       | 2           |                                                                                                                      |
    | oss://lakehouse-perf-test/tmp/tmp_pipe/copy.csv.zip | LOADED_FAILED | 0           | csv file: oss://lakehouse-perf-test/tmp/tmp_pipe/copy.csv.zip, line: 0: eatString throws quote(0) in unquote string, |
    | oss://lakehouse-perf-test/tmp/tmp_pipe/new_copy.csv | SUCCESS       | 2           |                                                                                                                      |
    +-----------------------------------------------------+---------------+-------------+----------------------------------------------------------------------------------------------------------------------+

    ```

# 注意事项

* 导入数据时建议您选择通用型计算集群(GENERAL PURPOSE VIRTUAL CLUSTER),通用型计算资源更加适合跑批量作业和加载数据作业
* 建议导入数据时选择同一个 Region，这样可以避免公网传输费用。在同一个 Region 且同一个云厂商内，数据传输通过内网进行。

# 具体案例

1.从user volume中加载数据

```SQL
--创建表
CREATE TABLE birds (
    id INT,
    name VARCHAR(50),
    wingspan_cm FLOAT,
    colors STRING
);
--将数据上传到user volume中
PUT '/Users/Downloads/data.csv' TO USER VOLUME FILE 'data.csv';
--导入文件数据至目标表
COPY INTO t_copy_from_volume FROM USER VOLUME  
USING csv  
OPTIONS(
        'header'='true',
        'lineSep'='\n'
)
FILES ('data.csv')
--删除volume中的文件，节省存储
PURGE=TRUE;
;
```

2.从table volume中加载数据

```SQL
CREATE TABLE birds (
    id INT,
    name VARCHAR(50),
    wingspan_cm FLOAT,
    colors STRING
);
--将数据上传到table volume中
PUT '/Users/Downloads/data.csv' TO TABLE VOLUME t_copy_from_volume FILE 'data.csv';
--导入文件数据至目标表
COPY INTO t_copy_from_volume FROM TABLE VOLUME t_copy_from_volume
USING csv  
OPTIONS(
        'header'='true',
        'lineSep'='\n'
)
FILES ('data.csv')
--删除volume中的文件，节省存储
PURGE=TRUE;
;

```

导出到外部 VOLUME 中使用，前提是需要创建 VOLUME 和 CONNECTION。创建过程可以参考 [CONNECTION创建](Datalake_StorageConnection.md) 和 [VOLUME创建](datalake_volume_object.md)。

3.将数据从oss中导入

```SQL
--创建表
CREATE TABLE birds (
    id INT,
    name VARCHAR(50),
    wingspan_cm FLOAT,
    colors STRING
);
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
--将数据如到表中
COPY INTO birds FROM 
VOLUME  my_volume
USING csv
SUBDIRECTORY 'dau_unload/read/';

```

4.将数据从cos中导入

```
--创建表
CREATE TABLE birds (
    id INT,
    name VARCHAR(50),
    wingspan_cm FLOAT,
    colors STRING
);
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
--将数据导入到表中
COPY INTO birds FROM 
VOLUME  my_volume
USING csv
SUBDIRECTORY 'dau_unload/read/';

```

5.将数据从s3中导入

```SQL
--创建表
CREATE TABLE birds (
    id INT,
    name VARCHAR(50),
    wingspan_cm FLOAT,
    colors STRING
);

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
--将数据导入到表中
COPY INTO birds FROM 
VOLUME  my_volume
USING csv
SUBDIRECTORY 'dau_unload/read/';
```


6. 导入 CSV 文件，并使用 JSON 函数解析，导入到 JSON 表中

```SQL
CREATE  TABLE pipe_json_load(col JSON);
COPY INTO pipe_json_load FROM(
SELECT parse_json(col)
FROM  VOLUME 
hz_csv_volume(
col
)
USING csv 
OPTIONS ('header' = 'false')
);
```

7. 导入过程中使用SQL和维度表做join。过滤需要导入的数据

```
--部分数据如下
create table departments (
  dept_id int ,
  dept_name varchar,
  location varchar
);
insert into departments values
(10, '销售部', '北京'),
(20, '研发部', '上海'),
(30, '财务部', '广州'),
(40, '人事部', '深圳');
--员工表如下
CREATE  TABLE employees (
          emp_id int,
          emp_name varchar,
          dept_id int,
          salary int
);
--在volume中存储的数据如下
10,"销售部","北京",
20,"研发部","上海",
30,"财务部","广州",
40,"人事部","深圳",
--要求只导入销售部的数据
COPY OVERWRITE employees FROM 
(SELECT f0::int,f1,f2::int,f3::int FROM 
VOLUME  my_volume
USING csv
files('dau_unload/employees/part00001.csv') 
join
departments   
on f3=dept_id
where dept_name='销售部'
);
```

8.导入Parquet文件并且使用正则匹配对应的文件

```SQL
COPY INTO hz_parquet_table
FROM VOLUME hz_parquet_volume
USING parquet 
REGEXP 'month=0[1-5].*.parquet';
```

9.导入BSON文件

```SQL
--LOAD FROM VOLUME USING BSON FORMAT
COPY INTO t_bson 
FROM VOLUME my_external_vol(
        name string, 
        age bigint, 
        city string, 
        interests array<string>
)
USING BSON
FILES( 'data.bson');
```


