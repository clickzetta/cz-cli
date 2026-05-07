# 使用内部 Volume

内部 Volume（Internal Volume）是系统提供的默认文件存储区域，用于临时存放待处理或待加载的数据文件。

* 对于没有云存储的用户，可以直接上传文件到内部 Volume 作为数据文件的主要存储区域，系统提供完全托管的存储服务。
* 而已使用云对象存储的用户，则可以选择使用外部 Volume（External Volume），通过直接挂载云存储路径进行访问，无需额外的数据迁移和复制。

系统目前支持三种类型的内部 Volume：User Volume、Table Volume 和命名 Volume。

### 使用User Volume

User Volume 是用户专属的个人存储空间，类似于操作系统中用户的默认工作目录，在 Lakehouse 中这个目录不可删除。用户默认对 User Volume 具备读写权限。

| **用户对 USER VOLUME 的操作** |
| :------------------------- |
| SHOW USER VOLUME DIRECTORY |
| SELECT FROM VOLUME         |
| PUT                        |
| GET                        |
| LIST USER VOLUME           |
| REMOVE                     |

* 查看User Volume下文件

```SQL
--查看user volume
SHOW USER VOLUME DIRECTORY;

relative_path                            url                                                                                                                                              size   last_modified_time  
---------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------ ------ ------------------- 
images/image-2024-05-22-11-25-23-519.png oss://lakehouse-hz/86/workspaces/ql_ws_8133192700078175627/internal_volume/user_4371011337311368544/images/image-2024-05-22-11-25-23-519.png 200494 2024-05-28 23:30:27 
images/image.png                         oss://lakehouse-hz/86/workspaces/ql_ws_8133192700078175627/internal_volume/user_4371011337311368544/images/image.png                         513894 2024-05-28 23:30:27 
taxi_zone_lookup.csv                     oss://lakehouse-hz/86/workspaces/ql_ws_8133192700078175627/internal_volume/user_4371011337311368544/taxi_zone_lookup.csv                     12331  2024-05-28 23:04:54 
tmp/taxi_zone_lookup.csv                 oss://lakehouse-hz/86/workspaces/ql_ws_8133192700078175627/internal_volume/user_4371011337311368544/tmp/taxi_zone_lookup.csv                 12331  2024-05-28 23:05:54 
tmp/taxi_zone_lookup_02.csv              oss://lakehouse-hz/86/workspaces/ql_ws_8133192700078175627/internal_volume/user_4371011337311368544/tmp/taxi_zone_lookup_02.csv              12331  2024-05-28 23:34:24 
```

* 上传、下载与删除文件

```SQL
--上传文件至user volume根目录
PUT '/Users/Downloads/taxi_zone_lookup.csv' TO USER VOLUME;

--上传文件并保存为user volume指定目录下指定文件名称
PUT '/Users/Downloads/taxi_zone_lookup.csv' TO USER VOLUME FILE 'tmp/taxi_zone_lookup_02.csv';

--通过通配符上传多个文件到Volume子目录
PUT '/Users/Downloads/images/*' TO USER VOLUME SUBDIRECTORY 'images/';

--从User Volume下载文件
GET USER VOLUME FILE 'images/image-2024-05-22-11-25-23-519.png' TO '/Users/Downloads/output/' ;

--删除User Volume下指定文件
REMOVE USER VOLUME FILE 'images/image-2024-05-22-11-25-23-519.png'

--删除User Volume下指定路径下所有文件
REMOVE USER VOLUME SUBDIRECTORY '/'
```

* 通过SQL查询User Volume下文件

```SQL
--通过SQL查询User Volume下指定文件
SELECT * FROM USER VOLUME 
USING CSV
OPTIONS(
        'header'='true'
)
FILES( 'taxi_zone_lookup.csv')
LIMIT 5;

LocationID Borough       Zone                    service_zone 
---------- ------------- ----------------------- ------------ 
1          EWR           Newark Airport          EWR          
2          Queens        Jamaica Bay             Boro Zone    
3          Bronx         Allerton/Pelham Gardens Boro Zone    
4          Manhattan     Alphabet City           Yellow Zone  
5          Staten Island Arden Heights           Boro Zone    


--通过SQL查询User Volume指定路径下所有文件
SELECT * FROM USER VOLUME using csv subdirectory '/tmp/';
```

* 使用 `get_presigned_url` 函数，获取 Volume 下文件在对象存储的待临时签名的真实访问路径。

```SQL
--获取presign url, 获取oss内网url
SELECT get_presigned_url(USER VOLUME , 'images/image.png' , 60) as url;

--获取presign url,获取对外url
set cz.sql.function.get.presigned.url.force.external=true;
SELECT get_presigned_url(USER VOLUME , 'images/image.png' , 60) as url;
```

### 使用Table Volume

每个Lakehouse 表默认关联一个存储空间，我们称之为Table Volume。用户对指定表的 Table Volume 进行操作时需要具备以下权限：

| **TABLE VOLUME 操作**                         | **对应 TABLE 权限需求**        |
| :----------------------------------------- | :--------------------- |
| SHOW TABLE VOLUME DIRECTORY \<table\_name> | SELECT                 |
| SELECT FROM VOLUME \<table\_name>          | SELECT                 |
| PUT                                        | INSERT,UPDATE,DELETE   |
| GET                                        | SELECT                 |
| LIST                                       | SCHEMA READ            |
| REMOVE                                     | INSERT, UPDATE, DELETE |

以下通过示例说明 Table Volume 的操作使用。

```SQL
--创建表
CREATE TABLE t_copy_from_volume(id int, name string);

--查看指定表的Table volume
SHOW TABLE VOLUME DIRECTORY t_copy_from_volume;
```

上传文件至目标表的TABLE VOLUME，要求访问用户具有目标表的写入权限。

```SQL
--上传文件至table volume，不指定存储路径默认保存在根路径下
PUT '/Users/Downloads/data.csv' TO TABLE VOLUME t_copy_from_volume FILE 'data.csv';

source                           target   source_size target_size status  
-------------------------------- -------- ----------- ----------- ------- 
/Users/Downloads/data.csv data.csv 34          34          SUCCEED 
```

使用SQL探查上传至TABLE VOLUME下文件数据。

```SQL
--查询
SELECT * FROM TABLE VOLUME t_copy_from_volume
USING CSV
OPTIONS(
        'header'='true',
        'lineSep'='\n'
)

id name  
-- ----- 
1  hello 
2  world 
3  !     
```

使用COPY INTO命令导入文件数据到目标表。

```SQL
COPY INTO t_copy_from_volume FROM TABLE VOLUME t_copy_from_volume(id int, name string)  USING csv  
OPTIONS(
        'header'='true',
        'lineSep'='\n'
)
FILES ('data.csv')
--删除volume中的文件，节省存储
PURGE=TRUE;
```

查询目标表，验证导入结果。

```SQL
--查看导入结果
SELECT * FROM t_copy_from_volume;

id name  
-- ----- 
1  hello 
2  world 
3  !     
```

删除TABLE VOLUME下文件。

```SQL
--删除Table Volume下指定文件
REMOVE TABLE VOLUME t_copy_from_volume  FILE 'data.csv'
--删除Table Volume下指定路径下所有文件
REMOVE TABLE VOLUME t_copy_from_volume subdirectory '/'
```

### 使用命名Volume

命名 Volume 是用户显式创建的，创建后存储在 Lakehouse 管理的内部存储中，无需额外云存储配置。它提供了比自动生成的用户级（User Volume）和表级（Table Volume）更精细的控制能力。

#### 语法说明

##### 创建命名 Volume

```SQL
CREATE VOLUME [ IF NOT EXISTS ] <volume_name>
    DIRECTORY = (
        enable =  true,    
        auto_refresh = true
    )
    RECURSIVE = true          -- 是否递归扫描子目录（默认false）
```

^

#### 删除Volume

```SQL
DROP VOLUME [ IF EXISTS ] <volume_name>
```

#### 使用具体案例

上传和下载数据

```sql
--创建volume
CREATE  VOLUME my_volume
    DIRECTORY = (
        enable=true,
        auto_refresh=true
    )
    RECURSIVE=true;
SHOW VOLUME DIRECTORY my_volume;

COPY INTO VOLUME my_volume  SUBDIRECTORY 'dau_unload/'
FROM TABLE public.students01
file_format = (
    type= CSV
    writebom=true
);
SHOW VOLUME DIRECTORY my_volume;
--本地上传下载测试
GET VOLUME my_volume FILE 'dau_unload/part00001.csv' TO '/tmp';
+---------------+--------------------+-------------+-------------+---------+
|    source     |       target       | source_size | target_size | status  |
+---------------+--------------------+-------------+-------------+---------+
| part00001.csv | /tmp/part00001.csv | 1472        | 1472        | SUCCEED |
+---------------+--------------------+-------------+-------------+---------+

 PUT '/tmp/part00001.csv' to volume my_volume file 'my.csv';
+--------------------+--------+-------------+-------------+---------+
|       source       | target | source_size | target_size | status  |
+--------------------+--------+-------------+-------------+---------+
| /tmp/part00001.csv | my.csv | 1472        | 1472        | SUCCEED |
+--------------------+--------+-------------+-------------+---------+

```

## 数据操作协议

| 协议类型         | 地址格式                             | 典型场景     |
| ------------ | -------------------------------- | -------- |
| User Volume  | volume\:user://\~/filename       | 用户私有资源   |
| Table Volume | volume\:table://table\_name/file | 表关联 ETL 文件 |
| Named Volume | volume://volume\_name/path       | 跨团队共享资源  |

* **User Volume 格式地址**: `volume:user://~/upper.jar`

  * `user` 表示使用 User Volume 协议。
  * `~` 表示当前用户，为固定值。
  * `upper.jar` 表示目标文件名。

* **Table Volume 格式地址**: `volume:table://table_name/upper.jar`

  * `table` 表示使用 Table Volume 协议。
  * `table_name` 表示表名，需根据实际情况填写。
  * `upper.jar` 表示目标文件名。

* **Named Volume 格式地址**: `volume://volume_name/upper.jar`

  * `volume_name`：创建的 Volume 名称
  * `upper.jar` 表示目标文件名。

^
