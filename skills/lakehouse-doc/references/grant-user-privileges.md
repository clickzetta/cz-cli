## 功能

本文档介绍了如何在 Lakehouse SQL 中使用 GRANT 语句，将指定的权限授予某个用户或角色。通过使用 GRANT 语句，您可以对用户进行细粒度的权限控制，确保数据安全和合规性。

## 语法

### 1. 将指定权限授予某用户

```SQL
GRANT workspacePrivileges ON WORKSPACE workspace_name
| workspaceObjectPrivileges ON { ROLE | SCHEMA | VCLUSTER | FUNCTION } workspace_object_name
| schemaPrivileges ON SCHEMA schema_name
| schemaObjectPrivileges ON { TABLE | VIEW | MATERIALIZED VIEW } schema_object_name
TO USER username [ WITH GRANT OPTION];
--参数解释    
workspacePriveleges ::=
    CREATE   { SCHEMA | VCLUSTER  }
 
-- workspace下对象授权
workspaceObjectPriveleges ::=
    -- SCHEMA
    ALTER | DROP | READ METADATA | ALL [PRIVILEGES]
    -- VCLUSTER
    ALTER | DROP | USE  |  READ METADATA | ALL [PRIVILEGES]
     --job
    ALTER | CANCEL | READ METADATA  | ALL [PRIVILEGES]


--schema授权
schemaPrivileges ::=
    CREATE  { TABLE |  VIEW | MATERIALIZED VIEW } | ALL

--schema下对象授权
schemaObjectPriveleges ::=
    -- table
   ALTER | DROP | SELECT | INSERT | READ METADATA | ALL
    -- view
   ALTER | DROP | SELECT  | ALL
    -- MATERIALIZED VIEW
   ALTER | DROP | SELECT | ALL 
```

参数说明

**1.workspacePriveleges**
workspace下创建对象的权限如CREATE VCLUSTER

**2.workspaceObjectPriveleges**
workspace下对象的修改和show权限

**3.schemaPrivileges**
schema下创建对象的权限

**4.schemaObjectPriveleges**
schema下对象表修改、表删除、表查询等权限

### - 将指定权限授予某用户

```
GRANT ROLE role_name TO USER user_name;
```

## 参数说明

1. `workspacePrivileges`：在 workspace 下创建对象的权限，例如 `CREATE SCHEMA`、`CREATE VCLUSTER` 等。
2. `workspaceObjectPrivileges`：在 workspace 下对象的修改和查询权限，例如 `ALTER`、`DROP`、`READ METADATA` 等。
3. `schemaPrivileges`：在 schema 下创建对象的权限，例如 `CREATE TABLE`、`CREATE VIEW`、`CREATE MATERIALIZED VIEW` 等。
4. `schemaObjectPrivileges`：在 schema 下对象的修改、查询等权限，例如 `ALTER`、`DROP`、`SELECT` 等。
5. `role_name`：角色名称，支持自定义角色和系统默认角色。系统默认角色包括 `system_admin`、`user_admin`、`security_admin`、`audit_admin` 等。
6. `username`：用户名称。
7. `WITH GRANT OPTION`：表示被授权的用户可以将这些权限再授权给其他用户。

## 使用示例

1. 授权给用户 `uat_demo` 在 `lakehouse_public` workspace 下创建 `VIRTUAL CLUSTER` 权限：
   ```SQL
   GRANT CREATE VCLUSTER ON WORKSPACE lakehouse_public TO USER uat_demo;
   ```

2. 授权给用户 `uat_demo` 修改名为 `default` 的 `VIRTUAL CLUSTER` 权限：
   ```SQL
   GRANT ALTER VCLUSTER ON VCLUSTER default TO USER  uat_demo;
   ```

3. 授权给用户 `uat_demo` 在 `public` schema 下创建表和视图的权限：
   ```SQL
   GRANT CREATE TABLE, CREATE VIEW ON SCHEMA public TO USER uat_demo;
   ```

4. 授权给用户 `uat_demo` 查询 `public` schema 下所有表和视图的权限：
   ```SQL
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO USER uat_demo;
   ```

5. 授权给角色 `user_admin` 的用户 `uat_demo` 在 `lakehouse_public` workspace 下的 `security` schema 下创建表和视图的权限：
   ```SQL
   GRANT CREATE TABLE, CREATE VIEW ON SCHEMA security TO ROLE user_admin;
   ```

通过以上示例，您可以根据实际需求灵活地为用户或角色分配相应的权限。请确保在授权时遵循最小权限原则，以降低安全风险。
