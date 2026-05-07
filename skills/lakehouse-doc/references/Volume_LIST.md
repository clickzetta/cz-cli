# LIST 命令

## 简介

LIST 命令返回已经存储在 Lakehouse 内部或者外部 Volume 中的文件列表。该命令可以在 Studio 和 Lakehouse 客户端中运行。

## 使用场景

* **导入前文件验证**：在将数据文件导入表前，确认文件已成功上传到 Volume 中，并检查文件命名是否符合规范。
* **导出后确认**：使用 COPY INTO 将数据导出到 Volume 后，验证所有文件是否正确生成，以及文件大小是否合理。
* **文件清理前确认**：在执行 REMOVE 命令删除 Volume 中的文件前，可使用 LIST 命令确认文件列表，避免误操作。

## 语法

```
LIST { VOLUME volume_name | TABLE VOLUME table_name | USER VOLUME } 
     [ SUBDIRECTORY 'subdir'| REGEXP = 'pattern' ]
```

## 参数说明

* `VOLUME volume_name `：列出指定外部 VOLUME 中的所有文件。
* `TABLE VOLUME table_name `：列出指定表的 VOLUME 空间下的所有文件。
* `USER VOLUME `：列出当前用户的 Volume 空间下的所有文件。
* `SUBDIRECTORY 'subdir': `：可选参数。用于指定要列出内容的 Volume 子目录，此选项可帮助缩小结果范围。
* `REGEXP = 'pattern': `：可选参数。用于指定过滤返回文件的正则表达式模式，您可以精确筛选出符合特定命名规则或格式的文件。

## 示例

* 列出外部 VOLUME `foodimages` 中所有含有数字“1”的文件：

```
LIST VOLUME foodimages REGEXP = '.*1.*'
```

* 列出外部 VOLUME `parquet_files` 中，`t_search_log` 子目录中的所有文件：

```
LIST VOLUME parquet_files SUBDIRECTORY 't_search_log'
```

* 列出外部 VOLUME `parquet_file` 中，`t_search_log` 子目录中以 `c000` 结尾的文件：

```
LIST VOLUME parquet_file SUBDIRECTORY 't_search_log' REGEXP = '.*c000' ;
```

## 注意事项

* 用户必须具有相应 Volume 的 `READ ` 权限才能执行 `LIST ` 命令。

^
