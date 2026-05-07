# GRANT TO SHARE 语句

## 功能描述

`GRANT TO SHARE` 语句的主要功能是将指定的表（table）或视图（view）添加到一个已存在的分享对象（share）中，并授予相应的权限。通过使用该语句，用户可以方便地对数据进行共享和管理，同时确保数据的安全性和可访问性。

仅支持将表（table）或视图（view）添加到类型（kind属性）为'OUTBOUND'（对外分享）的分享对象中。其他服务实例分享进入的分享对象（share）不可添加数据对象。

## 语法格式

```SQL
GRANT select, read metadata ON {TABLE <table_name> | VIEW <view_name>} TO SHARE <share_name>;
```

**参数说明**

1. **share_name**：需要操作的分享对象名称。
2. **table_name**：需要添加到分享对象中的表名称。
3. **view_name**：需要添加到分享对象中的视图名称。
4. **select, read metadata**：需要授予分享对象的权限点。`select` 权限允许对被分享的数据进行查询操作；`read metadata` 权限使得加入分享对象的表和视图的元数据对被分享方可见。当授予表或视图的 `read metadata` 权限时，其所属的模式（schema）的 `read metadata` 权限也将自动被授予至分享对象，以实现表和视图对被分享方的可见性。

## 使用示例

**示例 1：指定表进行分享**

假设我们有一个名为 `share_demo` 的分享对象，以及一个名为 `share_demo_table` 的表。我们希望将 `share_demo_table` 表添加到 `share_demo` 分享对象中，并授予 `select` 和 `read metadata` 权限。可以使用以下语句实现：

```SQL
GRANT select, read metadata ON TABLE share_demo_table TO SHARE share_demo;
```

**示例 2：指定视图进行分享**

在这个示例中，我们有一个名为 `share_demo` 的分享对象和一个名为 `share_demo_view` 的视图。我们希望将 `share_demo_view` 视图添加到 `share_demo` 分享对象中，并授予相应的权限。可以使用以下语句：

```SQL
GRANT select, read metadata ON VIEW share_demo_view TO SHARE share_demo;
```

**示例 3：同时分享多个表和视图**

有时，我们可能需要将多个表和视图添加到分享对象中。此时需要多次执行 GRANT 语句，每个 GRANT 语句将其中一个数据对象加入到指定的 share 对象中。以下示例展示了如何将 `share_demo_table1`、`share_demo_table2` 和 `share_demo_view` 添加到 `share_demo` 分享对象中，并授予相应的权限：

```SQL
GRANT select, read metadata ON TABLE share_demo_table1, share_demo_table2 TO SHARE share_demo;
GRANT select, read metadata ON VIEW share_demo_view TO SHARE share_demo;
```

## 注意事项

1. 在执行 `GRANT TO SHARE` 语句之前，请确保分享对象（share）已经存在。
2. 仅当您具备该对象的 select 和 read metadata 权限，并可将该权限做二次授权时，才可将该对象添加至数据分享对象中。
3. 当分享表或视图时，请确保充分考虑数据的安全性和可访问性，以避免不必要的风险。

^
