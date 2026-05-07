# 创建 Volume 访问阿里云 OSS 数据：

## 前提条件

在连接阿里云的 STORAGE CONNECTION 创建完成之后，就可以创建 Volume 对象访问对象存储数据了。

## 创建 Volume 对象

```SQL

CREATE EXTERNAL VOLUME sh_image_volume
    LOCATION 'oss://{bucket_name}/{path_to_data}'
    USING CONNECTION sh_oss_conn_public
    DIRECTORY = (
        enable=true,
        auto_refresh=true
    )
    RECURSIVE=true;
```

####

#### 2. 查看已创建 Volume 对象的详细信息

```SQL
DESC VOLUME sh_image_volume
```

#### 3. 查看创建 Volume 路径下的文件

```SQL
SHOW VOLUME DIRECTORY sh_image_volume;
```

#### 4. 在 Lakehouse Studio 中展示Volume 路径下的图片

当在 Lakehouse Studio 开发界面，通过 [get\_presigned\_url](GET_PRESIGNED_URL.md)` `函数获取图片的访问 url 时，可以直接点击 url -> **预览** 直接打开图片：

![](.topwrite/assets/20240103-102225.jpeg =726)
