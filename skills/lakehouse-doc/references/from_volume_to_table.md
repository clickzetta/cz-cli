# 从VOLUME 导入数据到表

**目标**：利用 COPY 命令和 SQL 语句，将 VOLUME 中的文件（CSV、Parquet、ORC、JSON 格式）导入到 Lakehouse 表中。

## 语法

```SQL
COPY INTO  TABLE_NAME 
FROM 
{ VOLUME external_volume_name | TABLE VOLUME table_name  | USER VOLUME }  
     ([column_list] )
[USING {CSV | ORC | PARQUET | JSON } 
    (formatTypeOptions)]
[FILES = ( '<file_name>'  , ...  )]
[COPYOPTIONS]
```

## 示例

### 示例 1：将 VOLUME 中的数据文件导入到表中

```
COPY INTO tbl_region 
FROM TABLE VOLUME region 
    (r_regionkey integer, r_name char(25), r_comment varchar(152)) 
USING csv OPTIONS('sep' = '|' ) 
FILES ('region.tbl')
--删除volume中的文件，节省存储
PURGE=TRUE;
```

### 示例 2：将针对 VOLUME 的 SELECT 查询结果写入表中

```
COPY INTO region 
FROM (SELECT * FROM TABLE VOLUME region 
         (r_regionkey integer, r_name char(25), r_comment varchar(152)) 
using csv Options( 'sep' = '|' ) 
FILES ('region.tbl') 
WHERE r_regionkey < 3)t
--删除volume中的文件，节省存储
PURGE=TRUE;
```

^
