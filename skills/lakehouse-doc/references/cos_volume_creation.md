# 创建 VOLUME 访问腾讯云的 COS 数据：

## 前提条件：

在腾讯云的 STORAGE CONNECTION 创建完成之后，就可以创建 VOLUME 对象来访问对象存储数据了。

## 创建 VOLUME 对象

```sql
CREATE EXTERNAL VOLUME my_tx_volume
  LOCATION 'cos://cz-volume-sh-1311343935/olist_bz'
  USING CONNECTION my_tx_connection
  DIRECTORY = (ENABLE = TRUE)
  RECURSIVE = TRUE;
```

### 查看已创建 VOLUME 对象的详细信息

```SQL
DESC VOLUME my_tx_volume
```

### 访问 COS 并查看 VOLUME 路径下的文件

```SQL
SHOW VOLUME DIRECTORY my_tx_volume;
```

### 将 VOLUME 目录的文件元数据存储到 Lakehouse 并查看

```
ALTER VOLUME my_tx_volume refresh;

SELECT * FROM DIRECTORY(VOLUME my_tx_volume);
```

^

![](.topwrite/assets/20240625-201914.jpeg)
