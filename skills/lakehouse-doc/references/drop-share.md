# DROP SHARE 语句

## 功能描述

`DROP SHARE` 语句用于删除已存在的 share 对象。share 对象通常用于在多个用户之间共享数据，删除 share 对象将移除该共享关系。

## 语法格式

```SQL
DROP SHARE <share_name>;
```

## 参数说明

* **share_name**：需要删除的 share 对象名称。

## 使用示例

1. 删除名为 `share_1` 的 share 对象：

   ```SQL
   DROP SHARE share_1;
   ```

2. 删除名为 `employee_data` 的 share 对象，该对象之前被用于在不同部门之间共享员工数据：

   ```SQL
   DROP SHARE employee_data;
   ```

## 注意事项

* 执行 `DROP SHARE` 语句前，请确保该 share 对象不再被其他用户或应用程序使用，以免造成数据访问异常。
* 删除 share 对象后，与之相关的共享权限也会被移除。需要重新配置共享权限时，请使用 `GRANT` 语句。
* 请谨慎操作，删除 share 对象是不可逆的操作。

## 相关语句

* [CREATE SHARE](create-share.md)：创建 share 对象。
* [ALTER SHARE](alter-share.md)：修改 share 对象的属性或权限。
* [SHOW SHARES](show-shares.md)：查询已存在的 share 对象列表。

^
