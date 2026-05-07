## 功能

本命令用于查看物化视图的结构，与查看表结构的命令相同。通过使用 DESC 命令，用户可以方便地获取物化视图的详细信息，包括字段名、数据类型、约束等，从而更好地了解物化视图的结构和特点。

有关更多详细信息，请参阅[物化视图](<MATERIALIZEDVIEW.md>)。

## 语法

```
DESC [物化视图名称];
```

参数说明：
- `物化视图名称`：指定需要查看结构的物化视图名称。

[参考 DESC 表](DESCTABLE.md)

## 示例

以下是使用 DESC 命令查看物化视图结构的示例：

示例 1：查看名为 `mv_inventory_refresh` 的物化视图结构
```
DESC mv_inventory_refresh;
```

示例 2：查看名为 `mv_sales` 的物化视图结构，并显示详细信息
```
DESC EXTENDED mv_inventory_refresh;
```
![](.topwrite/assets/image_1735201877904.png)
