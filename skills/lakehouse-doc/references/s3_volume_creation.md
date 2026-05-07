# 创建 VOLUME 访问 AWS S3 数据

## 前提条件

在 STORAGE CONNECTION 创建完成后，就可以创建 VOLUME 对象来访问对象存储数据了。

```sql
CREATE EXTERNAL VOLUME aws_s3_volume_arn
  LOCATION 's3://cz-udf-user/'
  USING CONNECTION aws_bj_conn_arn
  DIRECTORY = (
    ENABLE=true
  )
  RECURSIVE = true;
```

### 查看已创建 VOLUME 对象的详细信息

```SQL
DESC VOLUME aws_s3_volume_arn
```

### 访问 S3 查看 VOLUME 路径下的文件

```SQL
SHOW VOLUME DIRECTORY aws_s3_volume_arn;
```

### 将 VOLUME 目录的文件元数据存储到 Lakehouse 并查看

```
ALTER VOLUME aws_s3_volume_arn refresh;

SELECT * FROM DIRECTORY(VOLUME aws_s3_volume_arn);
```

![](.topwrite/assets/20240626-220826.jpeg)
