# 功能

本文介绍了如何创建自定义角色以及对现有角色进行替换的 SQL 语法。
# Workspace角色管理
## 语法

```SQL
CREATE [OR REPLACE] ROLE [IF NOT EXISTS] role_name COMMENT '';
```

- **CREATE**: 创建一个新的角色。
- **OR REPLACE** (可选): 如果已存在同名角色，则替换该角色。
- **IF NOT EXISTS** (可选): 如果指定的角色名称不存在，则创建新角色。如果角色已存在，不会报错，也不会创建新角色。
- **role_name**: 指定新角色的名称。请注意，角色名称不能与系统预定义的角色名称相同。
- **COMMENT** (可选): 为角色添加注释，可以留空或提供有关角色的信息。

## 示例

1. 创建一个名为 `simple_role` 的自定义角色：

   ```SQL
   CREATE ROLE simple_role;
   ```

2. 创建一个名为 `admin_role` 的角色，并为其添加注释：

   ```SQL
   CREATE ROLE admin_role COMMENT '拥有高级权限的角色';
   ```

3. 替换已存在的 `existing_role` 角色：

   ```SQL
   CREATE OR REPLACE ROLE existing_role;
   ```

4. 创建一个名为 `new_role` 的角色，如果该角色已存在，则不会创建新角色：

   ```SQL
   CREATE ROLE IF NOT EXISTS new_role;
   ```

# Instance Role 管理

LakeHouse 支持在 **实例粒度（Instance-Level）** 创建角色，实现跨工作空间（Workspace）的统一权限管控，满足多团队协作场景下的精细化访问控制。需要INSTANCE_ADMIN可以执行此操作

## 语法说明

```SQL
-- 创建 Instance Role（若不存在）
CREATE INSTANCE ROLE IF NOT EXISTS <role_name>;
-- 删除 Instance Role（如果存在）
DROP INSTANCE ROLE IF EXISTS <role_name>;
-- 查看所有 Instance Role
SHOW INSTANCE ROLES;
```

#### 示例

```SQL

DROP INSTANCE ROLE IF EXISTS inst_role;

CREATE INSTANCE ROLE IF NOT EXISTS inst_role;

SHOW INSTANCE ROLES;
```




