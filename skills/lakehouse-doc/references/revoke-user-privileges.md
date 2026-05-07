## 功能描述

本命令用于回收指定用户或角色的权限。您可以根据需要从用户或角色中回收各种类型的权限，包括但不限于对工作空间、模式（Schema）和工作空间对象的权限。

## 语法详解

```SQL
REVOKE [GRANT OPTION FOR]

workspacePriveleges ON WORKSPACE workspace_name
| workspaceObjectPriveleges ON { ROLE | SCHEMA | VCLUSTER | FUNCTION } workspace_object_name
| schemaPrivileges ON SCHEMA schema_name
| schemaObjectPriveleges ON { TABLE | VIEW | MATERIALIZED VIEW } schema_object_name
FROM USER user_name

-- 参数解释
workspacePriveleges ::=
    CREATE { SCHEMA | VCLUSTER }

-- 工作空间下对象授权
workspaceObjectPriveleges ::=
    -- SCHEMA
    ALTER | DROP | READ METADATA | ALL [PRIVILEGES]
    -- VCLUSTER
    ALTER | DROP | USE | READ METADATA | ALL [PRIVILEGES]
    --job
    ALTER | CANCEL | READ METADATA | ALL [PRIVILEGES]

--schema授权下创建对象授权
schemaPrivileges ::=
    CREATE { TABLE | VIEW | MATERIALIZED VIEW } | ALL

--schema下的对象授权
schemaObjectPriveleges ::=
    -- table
    ALTER | DROP | SELECT | INSERT | READ METADATA | ALL
    -- view
    ALTER | DROP | SELECT | ALL
    -- MATERIALIZED VIEW
    ALTER | DROP | SELECT | ALL
```

## 参数说明

1. `workspacePriveleges`：授予在工作空间下创建对象的权限，例如创建模式（Schema）和虚拟集群（VCLUSTER）。

2. `workspaceObjectPriveleges`：授予对工作空间下对象的修改和查看元数据的权限。

3. `schemaPrivileges`：授予在模式（Schema）下创建对象的权限，例如创建表、视图和物化视图。

4. `schemaObjectPriveleges`：授予对模式（Schema）下对象的修改、删除、查询等操作的权限。

## 使用示例

1. 回收用户 `uat_demo` 在 `lakehouse_public` 工作空间下创建虚拟集群的权限：

   ```SQL
   REVOKE CREATE VCLUSTER ON WORKSPACE lakehouse_public FROM USER uat_demo;
   ```

2. 回收用户 `uat_demo` 修改名为 `default` 的虚拟集群的权限：

   ```SQL
   REVOKE ALTER VCLUSTER ON VCLUSTER default FROM USER uat_demo;
   ```

3. 回收用户 `uat_demo` 在 `public` 模式下创建表和视图的权限：

   ```SQL
   REVOKE CREATE VIEW, CREATE TABLE ON SCHEMA public FROM USER uat_demo;
   ```

4. 回收用户 `uat_demo` 查询名为 `my_table` 的表的权限：

   ```SQL
   REVOKE SELECT ON TABLE public.my_table FROM USER uat_demo;
   ```

5. 回收角色 `reporting_role` 在 `sales` 模式下创建视图的权限：

   ```SQL
   REVOKE CREATE VIEW ON SCHEMA sales FROM ROLE reporting_role;
   ```

6. 回收用户 `data_engineer` 在 `lakehouse_public` 工作空间下的所有权限：

   ```SQL
   REVOKE ALL PRIVILEGES ON WORKSPACE lakehouse_public FROM USER data_engineer;
   ```

请根据您的实际需求选择合适的权限类型和对象进行操作。在执行此命令前，请确保您自身具有足够的权限来回收其他用户或角色的权限。