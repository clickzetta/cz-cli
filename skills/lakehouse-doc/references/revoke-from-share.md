# REVOKE FROM SHARE 语句

## 功能描述

`REVOKE FROM SHARE` 语句用于取消已分享的表（table）或视图（view）的权限。通过执行该语句，可以撤销其他用户或角色对分享对象的访问权限。

仅支持修改类型（kind属性）为'OUTBOUND'（对外分享）的分享对象。其他服务实例分享进入的分享对象（share）不可移除数据对象。

## 语法格式

```SQL
REVOKE [PERMISSIONS] ON {TABLE table_name | VIEW view_name} FROM SHARE share_name;
```

**参数说明**

* `PERMISSIONS`：指定要撤销的权限，可选值为 `select`（用于查询数据）和 `read metadata`（用于查看表或视图的元数据）。
* `TABLE table_name`：指定要撤销权限的表名。
* `VIEW view_name`：指定要撤销权限的视图名。
* `share_name`：指定要操作的分享名称。

## 使用示例

1. 撤销用户对分享表的查询权限和元数据查看权限：

   ```SQL
   REVOKE select, read metadata ON TABLE share_demo_table FROM SHARE share_demo;
   ```

2. 仅撤销用户对分享视图的查询权限：

   ```SQL
   REVOKE select ON VIEW share_demo_view FROM SHARE share_demo;
   ```

3. 撤销用户对分享表的元数据查看权限，但保留查询权限：

   ```SQL
   REVOKE read metadata ON TABLE share_demo_table FROM SHARE share_demo;
   ```

## 注意事项

* 执行 `REVOKE FROM SHARE` 语句前，请确保您具有足够的权限来撤销分享对象的权限。
* 被撤销权限的用户或角色将无法再访问指定的表或视图。
* 如果需要重新授予权限，可使用 `GRANT` 语句进行操作。

通过以上内容，您可以更好地理解和使用 `REVOKE FROM SHARE` 语句来管理分享对象的权限。
