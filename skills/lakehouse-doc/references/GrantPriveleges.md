## 功能描述

本文档介绍了如何在 Lakehouse SQL 中使用 GRANT 语句，将指定的权限授予给角色。通过该操作，角色将获得对指定资源的访问和操作权限。

## Workspace 用户和角色权限管理语法

### 1. 授予 Workspace 级别权限
```SQL
GRANT workspacePrivileges  ON WORKSPACE  workspace_name
| workspaceObjectPriveleges ON { ROLE | SCHEMA | VCLUSTER | DATALAKE | FUNCTION  workspace_object_name
| schemaPrivileges ON SCHEMA schema_name  
| schemaObjectPriveleges  ON { TABLE | VIEW | MATERIALIZED VIEW } schema_object_name
TO ROLE  rolename
```
- **参数说明：**
  - `workspacePrivileges`：指定授予的 Workspace 级别权限，例如：CREATE SCHEMA, CREATE VCLUSTER。
  - `workspace_name`：指定要授权的 Workspace 名称。
  - `rolename`：指定要授予权限的角色名称。

### 2. 授予 Workspace 对象权限
```SQL
GRANT workspaceObjectPriveleges ON { ROLE | SCHEMA | VCLUSTER | DATALAKE | FUNCTION } workspace_object_name TO ROLE rolename;
```
- **参数说明：**
  - `workspaceObjectPriveleges`：指定授予的 Workspace 对象权限，例如：ALTER, DROP, READ METADATA, ALL [PRIVILEGES]。
  - `workspace_object_name`：指定要授权的 Workspace 对象名称。
  - `rolename`：指定要授予权限的角色名称。

### 3. 授予 Schema 级别权限
```SQL
GRANT schemaPrivileges ON SCHEMA schema_name TO ROLE rolename;
```
- **参数说明：**
  - `schemaPrivileges`：指定授予的 Schema 级别权限，例如：CREATE TABLE, CREATE VIEW, CREATE MATERIALIZED VIEW, ALL。
  - `schema_name`：指定要授权的 Schema 名称。
  - `rolename`：指定要授予权限的角色名称。

### 4. 授予 Schema 对象权限
```SQL
GRANT schemaObjectPriveleges ON { TABLE | VIEW | MATERIALIZED VIEW } schema_object_name TO ROLE rolename;
```
- **参数说明：**
  - `schemaObjectPriveleges`：指定授予的 Schema 对象权限，例如：ALTER, DROP, SELECT, INSERT, READ METADATA, ALL。
  - `schema_object_name`：指定要授权的 Schema 对象名称。
  - `rolename`：指定要授予权限的角色名称。

## 使用示例

示例 1：授予角色创建 VIRTUAL CLUSTER 权限
```SQL
GRANT CREATE VCLUSTER ON WORKSPACE lakehouse_public TO ROLE simple_role;
```

示例 2：授予角色修改 VIRTUAL CLUSTER 权限
```SQL
GRANT ALTER VCLUSTER ON VCLUSTER default TO ROLE simple_role;
```

示例 3：授予角色创建表和创建视图的权限
```SQL
GRANT CREATE VIEW, CREATE TABLE ON SCHEMA public TO ROLE simple_role;
```

示例 4：授予角色对指定表的查询和修改权限
```SQL
GRANT SELECT, ALTER ON TABLE public.my_table TO ROLE my_role;
```

示例 5：授予角色对指定视图的查询和修改权限
```SQL
GRANT SELECT, ALTER ON VIEW public.my_view TO ROLE my_role;
```

## ### 示例 6：授予角色对指定物化视图的查询和修改权限
```SQL
GRANT SELECT, ALTER ON MATERIALIZED VIEW public.my_materialized_view TO ROLE my_role;
```

通过以上示例，您可以根据实际需求为角色授予相应的权限。请注意，授予的权限应与角色的职责和工作内容相匹配，以确保数据安全和权限的合理分配。

## Instance Role 授权

通过 Instance Role 可授予跨工作空间的全局权限，授权对象包括用户或其他角色。

### 语法说明

```SQL
-- 将 Instance Role 授予用户/角色
GRANT INSTANCE ROLE <role_name> TO USER <user_name>;
-- 授予 Instance Role 全局权限
GRANT <privilege> ON WORKSPACE <workspace_name> TO INSTANCE ROLE <role_name>;
-- 回收权限
REVOKE <privilege> ON WORKSPACE <workspace_name> FROM INSTANCE ROLE <role_name>;
-- 查看 Instance Role 权限
SHOW GRANTS TO INSTANCE ROLE <role_name>;
```

#### 示例

```SQL
-- 授予用户 Instance Role
GRANT INSTANCE ROLE inst_role TO USER lh_engine_test_01;
-- 授予工作空间全部权限
GRANT ALL ON WORKSPACE ws1 TO INSTANCE ROLE inst_role;
-- 查看权限（预期含跨空间授权记录）
SHOW GRANTS TO INSTANCE ROLE inst_role;
-- 回收工作空间权限
REVOKE ALL ON WORKSPACE ws1 FROM INSTANCE ROLE inst_role;
-- 验证权限回收
SHOW GRANTS TO INSTANCE ROLE inst_role;
-- 授予单表权限（标准语法兼容）
GRANT ALL ON TABLE ws1.schema.table TO INSTANCE ROLE inst_role;
```
