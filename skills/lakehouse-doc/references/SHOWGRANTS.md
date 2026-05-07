# 功能

**查看权限信息**：本命令用于查询当前用户或指定角色所拥有的权限，帮助用户了解权限设置情况，确保数据访问的安全性。

# Workspace 角色查看权限语法

```SQL
-- 查看当前用户的权限
SHOW GRANTS;

-- 查询指定角色的权限
SHOW GRANTS TO ROLE role_name;
```

**参数说明：**

- **role_name**：需要查询权限的角色名称，该角色必须存在于当前数据库空间中。

## 使用示例

**示例 1**：查看当前用户的权限

```SQL
SHOW GRANTS;
```

执行该命令后，系统将列出当前用户拥有的所有权限信息。

**示例 2**：查询指定角色的权限

```SQL
SHOW GRANTS TO ROLE simple_role;
```

执行该命令后，系统将列出`simple_role`角色所拥有的权限信息。

**示例 3**：查询具有多个权限的角色信息

假设有一个名为`admin_role`的角色，拥有多个权限，可以使用以下命令查询：

```SQL
SHOW GRANTS TO ROLE admin_role;
```

执行该命令后，系统将列出`admin_role`角色拥有的所有权限信息。
# Instance 角色查看权限语法

```SQL
-- 查询指定角色的权限
SHOW GRANTS TO  INSTANCE ROLE role_name;
```

**参数说明：**

- **role_name**：需要查询权限的角色名称，该角色必须存在于当前数据库空间中。

## 使用示例

```
-- 查看某个角色的权限
SHOW GRANTS TO INSTANCE ROLE instanc_datamap_user;
```