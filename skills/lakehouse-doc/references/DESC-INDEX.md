# 查看索引详情

## 简介

`DESC INDEX` 查询索引的创建日期和名称。

## 语法

```
DESC INDEX [EXTENDED] index_name;
```

## 参数说明

* `index_name`：要查看的索引名称。
* EXTENDED: 可以查看索引的更多扩展信息，比如倒排索引大小。目前不支持查看 Bloom Filter 索引大小。

## 使用示例

示例 1：查看名为 `idx_users_email` 的索引详情。

```
DESC INDEX EXTENDED order_year_index;
+--------------------------+--------------------------+
|        info_name         |        info_value        |
+--------------------------+--------------------------+
| name                     | order_year_index         |
| creator                  | UAT_TEST                 |
| created_time             | 2024-12-27 10:51:58.977  |
| last_modified_time       | 2024-12-27 10:51:58.977  |
| comment                  |                          |
| properties               | (("analyzer","chinese")) |
| index_type               | inverted                 |
| table_name               | t                        |
| table_column             | order_year               |
| index_size_in_data_file  | 0                        |
| index_size_in_index_file | 296                      |
| total_index_size         | 296                      |
+--------------------------+--------------------------+
```

