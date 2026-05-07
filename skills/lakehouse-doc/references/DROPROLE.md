# 从当前 workspace 删除角色

## Workspace 角色管理

本命令用于从当前 workspace 中删除一个角色。请注意，执行此操作后，该角色将无法再访问与之关联的资源和权限。

## 语法

```SQL
DROP ROLE [IF EXISTS] role_name;
```

- `role_name`：要删除的角色名称。

## 使用说明

- 在执行删除操作前，请确保不再需要该角色。删除后，该角色将无法恢复。
- 使用 `IF EXISTS` 选项可以避免在角色不存在时出现错误提示。
- 请确保您具有足够的权限来执行此操作。

## 示例

1. 删除名为 `simple_role` 的角色：

```SQL
DROP ROLE simple_role;
```

2. 使用 `IF EXISTS` 选项删除名为 `temporary_role` 的角色，以避免在角色不存在时出现错误提示：

```SQL
DROP ROLE IF EXISTS temporary_role;
```

3. 删除具有特定权限的角色 `report_user`：

```SQL
DROP ROLE report_user;
```

## 注意事项

- 执行此命令将永久删除角色及其关联的权限和资源。请谨慎操作。
- 在删除角色前，请确保已将该角色的权限和资源分配给其他角色或用户，以防止数据丢失或权限问题。
- 如果您不确定某个角色是否还在使用中，请先进行查询操作，以确保不会误删重要角色。
# 删除 Instance Role

```
DROP INSTANCE ROLE IF EXISTS <role_name>;
```

## 使用说明

- 在执行删除操作前，请确保不再需要该角色。删除后，该角色将无法恢复。
- 使用 `IF EXISTS` 选项可以避免在角色不存在时出现错误提示。
- 需要 INSTANCE_ADMIN 权限才可以执行此操作。