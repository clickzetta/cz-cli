# GET\_PRESIGNED\_URL 函数

该函数通过输入 Volume 名称、文件的相对路径和有效时间（秒），为 Volume 中的文件生成一个预签名 URL。此功能允许应用程序访问存储在外部 Volume 中的文件。

## 使用场景

以下是几种访问 Volume 中文件的方法：

1. 在 Web 浏览器中直接访问带有一个预签名的 URL（字符串类型）。
2. 将 Volume 中文件的预签名 URL 发送给远程函数进行处理。

## 注意事项

1. 执行该函数的用户需要对 Volume 对象具有读取 (READ) 权限。

2. 该函数需要从 Volume 本地的元数据系统中获取文件信息（例如 `relative_path`）。请确保刚刚导入的 Volume 对应的文件元数据已经同步到 Lakehouse 元数据系统，或使用以下命令进行刷新：

   ```
   ALTER VOLUME <volume_name> REFRESH;
   ```

3. GET\_PRESIGNED\_URL 是一个非确定性函数 (non-deterministic function)，即在给定相同输入值的情况下，每次执行的输出结果可能不同。

## 语法

```
GET_PRESIGNED_URL(VOLUME volume_name | TABLE VOLUME table_name | USER VOLUME , '<relative_file_path>', [<expiration_time>])
```

## 参数

* **volume \<volume\_name**>**：`volume` 为固定关键字，表示后面的对象类型为 Volume；`volume_name` 为系统创建的 Volume 名称。
* **relative\_file\_path**：相对于 Volume 指定位置的文件路径和文件名。可以通过调用 `directory` 函数获取：
  ```
  SELECT GET_PRESIGNED_URL(volume <volume_name>, relative_path) AS pre_signed_url
  FROM DIRECTORY(volume <volume_name>);
  ```
* **expiration\_time**：生成的预签名 URL 的有效期，以秒为单位。默认值为 3600 秒（60 分钟）。

## 返回值

一个预签名的 URL（字符串类型）。

## 使用示例

以下是几个使用 GET\_PRESIGNED\_URL 函数的示例：

1. 生成一个有效期为 1 小时的预签名 URL：

   ```
   SELECT GET_PRESIGNED_URL(volume hz_image_volume, 'example.jpg', 3600) AS pre_signed_url;
   ```

2. 生成一个默认有效期（1 小时）的预签名 URL：

   ```
   SELECT GET_PRESIGNED_URL(USER VOLUME, 'pangxie_pic.jpg', 3600) AS pre_signed_url;
   ```

3. 从目录中获取文件的相对路径，并生成一个预签名 URL：

   ```
   SELECT GET_PRESIGNED_URL(volume hz_image_volume, relative_path) AS pre_signed_url
   FROM DIRECTORY(volume hz_image_volume);
   ```

> 注意：如果生成的 URL 无法访问，可能是因为生成了对象存储的内部链接。可尝试在执行 SQL 前添加以下参数后再次尝试：
>
> `set cz.sql.function.get.presigned.url.force.external=true;`
>
> 例如：
>
> ```
> SET cz.sql.function.get.presigned.url.force.external=true; 
> SELECT GET_PRESIGNED_URL(USER VOLUME, 'pangxie_pic.jpg', 3600) AS pre_signed_url;
> ```

4. 批量获取 USER VOLUME 中图片的预签名 URL

   ```
    SET cz.sql.function.get.presigned.url.force.external=true;
    SELECT relative_path,
    GET_PRESIGNED_URL(USER VOLUME, relative_path, 3600) AS pre_signed_url
    FROM (
          SELECT relative_path FROM (LIST USER VOLUME)
    );
    ```

通过以上示例，您可以更好地了解如何在不同场景中使用 GET\_PRESIGNED\_URL 函数。请根据您的实际需求调整参数和代码。

^
