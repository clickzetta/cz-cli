## 功能

本命令用于回收指定角色的权限。通过使用 REVOKE 语句，可以对不同级别的权限进行回收，包括 workspace、workspace 对象、schema 和 schema 对象等级别。

## Workspace 用户和角色权限管理语法

```SQL
REVOKE [workspacePrivileges | workspaceObjectPrivileges | schemaPrivileges | schemaObjectPrivileges]
ON [WORKSPACE | {ROLE | SCHEMA | VCLUSTER | DATALAKE | FUNCTION | workspace_object_name | SCHEMA | {TABLE | VIEW | MATERIALIZED VIEW} schema_object_name]
FROM ROLE role_name;
```

### 参数说明

1.  **workspacePrivileges**：在 workspace 下创建对象的权限，例如 `CREATE SCHEMA` 和 `CREATE VCLUSTER`。

2.  **workspaceObjectPrivileges**：对 workspace 下对象的修改和查看元数据等权限，例如 `ALTER`、`DROP`、`READ METADATA` 和 `ALL [PRIVILEGES]`。

3.  **schemaPrivileges**：在 schema 下创建对象的权限，例如 `CREATE TABLE`、`CREATE VIEW` 和 `CREATE MATERIALIZED VIEW`。

4.  **schemaObjectPrivileges**：对 schema 下对象的修改、删除、查询等权限，例如 `ALTER`、`DROP`、`SELECT`、`INSERT`、`READ METADATA` 和 `ALL`。

## 示例

1.  回收角色 `simple_role` 在 `lakehouse_public` workspace 下创建 `VIRTUAL CLUSTER` 的权限：

    ```SQL
   REVOKE CREATE VCLUSTER ON WORKSPACE lakehouse_public FROM ROLE simple_role;
   ```

2.  回收角色 `simple_role` 在名为 `default` 的 `VIRTUAL CLUSTER` 上的 `ALTER` 权限：

    ```SQL
   REVOKE ALTER VCLUSTER ON VCLUSTER default FROM ROLE simple_role;
   ```

3.  回收角色 `uat_demo` 在 `public` schema 下创建表和视图的权限：

    ```SQL
   REVOKE CREATE VIEW, CREATE TABLE ON SCHEMA public FROM ROLE uat_demo;
   ```

4.  回收角色 `reporting_role` 在名为 `sales_data` 的 `DATALAKE` 上的 `READ METADATA` 权限：

    ```SQL
   REVOKE READ METADATA ON DATALAKE sales_data FROM ROLE reporting_role;
   ```

5.  回收角色 `admin_role` 在名为 `order_summary` 的 `FUNCTION` 上的 `ALTER` 和 `DROP` 权限：

    ```SQL
   REVOKE ALTER, DROP ON FUNCTION order_summary FROM ROLE admin_role;
   ```

6.  回收角色 `analyst_role` 在 `public` schema 下名为 `customer_orders` 的 `TABLE` 上的 `SELECT` 和 `INSERT` 权限：

    ```SQL
   REVOKE SELECT, INSERT ON TABLE public.customer_orders FROM ROLE analyst_role;
   ```



# Instance Role 权限管理
LakeHouse 支持对 Instance Role 的跨工作空间权限进行细粒度回收，确保权限管控的灵活性和安全性。

## 语法说明
```sql
-- 回收 Instance Role 对工作空间的权限  
REVOKE <privilege> ON WORKSPACE <workspace_name> FROM INSTANCE ROLE <role_name>;  

-- 回收 Instance Role 对表/库的权限  
REVOKE <privilege> ON TABLE <workspace>.<schema>.<table> FROM INSTANCE ROLE <role_name>;  

REVOKE <privilege> ON DATABASE <workspace>.<schema> FROM INSTANCE ROLE <role_name>;  

-- 移除用户的 Instance Role 归属  
REVOKE INSTANCE ROLE <role_name> FROM USER <user_name>;  
```

## 示例
```sql
-- 回收工作空间全部权限  
REVOKE ALL ON WORKSPACE ws1 FROM INSTANCE ROLE inst_role;  

-- 验证回收结果（预期无 ALL 权限）  
SHOW GRANTS TO INSTANCE ROLE inst_role;  

-- 回收单表权限  
REVOKE ALL ON TABLE ws1.public.sales FROM INSTANCE ROLE inst_role;  

-- 移除用户的 Instance Role  
REVOKE INSTANCE ROLE inst_role FROM USER lh_engine_test_01;  
```





