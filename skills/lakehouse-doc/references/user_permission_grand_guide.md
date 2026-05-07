# Lakehouse用户授权入门指导

## 1. 引言

云器Lakehouse采用了灵活且强大的权限管理体系，通过基于角色的访问控制（RBAC）实现细粒度的数据访问管理。本指南将结合理论知识和实际操作，详细介绍Lakehouse的用户授权管理流程，帮助管理员高效管理数据资源访问权限。

本指南也通过一个实际实验来验证这个过程。

^

:-: ![](.topwrite/assets/image_1747735632210.png =796)

^

## 2. 用户管理体系架构

### 2.1 用户层级关系

云器Lakehouse的用户管理体系分为两个层级：

* **全局用户**：在云器平台上全局管理的用户，每个用户拥有独立的身份，具备唯一用户名和密码。
* **工作空间用户**：在特定Lakehouse服务实例中的特定工作空间里的用户，仅在工作空间内内可被授予相应角色和权限。

> **重要概念**：全局用户会自动同步至各服务实例，成为服务实例用户，为所有空间供应用户身份，但是需要进一步在空间内授权。因此，当我们在工作空间内通过SQL创建用户时，本质上是将已存在于服务实例中的用户添加到当前工作空间，是一种工作空间级别的授权操作，而非真正意义上的用户创建。这就是为什么在工作空间内使用SQL创建用户时不需要指定密码。

### 2.2 用户类型

* **普通用户**：代表企业内实际人员，用于日常的数据查询、分析和管理操作。
* **服务用户**：满足自动化流程或系统级别操作的特殊用户，不允许Web登录，但可用于JDBC连接或调度任务。

## 3. 角色管理基础

### 3.1 角色定义与类型

角色是一种授权管理工具，将多个权限点集中在一起，再授予给一个或多个用户。Lakehouse中的角色分为两种类型：

* **预置角色**：系统自动配置的角色，不可删除，可以修改权限\*，可直接授予给用户。
* **自定义角色**：用户根据业务需求创建的角色，可灵活配置与维护权限。

\*说明：预置角色中，工作空间管理员（workspace\_admin）和实例管理员（instance\_admin）不允许修改权限。其他预置角色可以修改权限。

### 3.2 角色级别

* **实例角色（Instance Role**）：用于实例级资源和操作的全局管控，或跨多个工作空间的权限授予。
* **工作空间角色（Workspace Role**）：作用于特定工作空间内的对象，如schema、table、virtual cluster等。

## 4. 实际操作步骤

### 4.1 用户管理操作

**1. 在工作空间中添加用户**

```sql
-- 将已存在于服务实例的用户添加到当前工作空间
CREATE USER username;
```

**2. 查看工作空间内的用户**

```sql
-- 显示当前工作空间内的所有用户
SHOW USERS;
```

**3. 删除工作空间内的用户**

```sql
-- 从当前工作空间移除用户（不影响服务实例中的用户）
DROP USER username;
```

### 4.2 角色管理操作

**1. 创建自定义角色**

```sql
-- 创建工作空间级别的自定义角色
CREATE ROLE role_name;
```

**2**. **查看角色**

```sql
-- 查看当前工作空间内的所有角色
SHOW ROLES;
```

**3. 删除角色**

```sql
-- 删除自定义角色
DROP ROLE role_name;
```

### 4.3 权限授予操作

**1. 授予Schema级别权限**

```sql
-- 授予角色在Schema上创建表和视图的权限
GRANT CREATE TABLE, CREATE VIEW ON SCHEMA schema_name TO ROLE role_name;
```

**2. 授予表级别权限**

```sql
-- 授予角色对表的查询、修改等权限
GRANT SELECT, INSERT, UPDATE, DELETE, ALTER ON TABLE schema_name.table_name TO ROLE role_name;
```

**3. 授予视图权限**

```sql
-- 授予角色对视图的查询权限
GRANT SELECT VIEW schema_name.view_name TO ROLE role_name;
```

**4. 将角色授予用户**

```sql
-- 将角色授予给用户
GRANT ROLE role_name TO USER username;
```

### 4.4 权限撤销操作

**1. 撤销对象权限**

```sql
-- 撤销表的SELECT权限
REVOKE SELECT ON TABLE schema_name.table_name FROM ROLE role_name;
```

**2. 撤销用户角色**

```sql
-- 从用户撤销角色
REVOKE ROLE role_name FROM USER username;
```

## 5. 权限验证与审计

### 5.1 查询用户权限

```sql
-- 查看用户被授予的角色和权限
SHOW GRANTS TO USER username;
```

### 5.2 查询角色权限

```sql
-- 查看角色被授予的具体权限
SHOW GRANTS TO ROLE role_name;
```

### 5.3 查询对象权限被授出的权限

```sql
-- 查看表被授出的具体权限及授出给哪个角色/用户
SHOW GRANTS ON table schema_name.table_name;
```

### 5.3 查询当前用户

```sql
-- 获取当前登录用户
SELECT CURRENT_USER();
```

##

## 6. 完整实验案例

以下是一个完整的用户授权管理实践案例，从创建用户到清理环境的全流程：

### 6.1 创建测试用户

```sql
-- 创建测试用户（将服务实例用户添加到工作空间）
CREATE USER test01;
CREATE USER test02;

-- 验证用户创建是否成功
SHOW USERS;
```

### 6.2 创建测试环境

```sql
-- 创建测试Schema和表
CREATE SCHEMA IF NOT EXISTS permission_test_schema;

CREATE TABLE IF NOT EXISTS permission_test_schema.permission_test_sales_data (
    id INT,
    product_name VARCHAR(100),
    sale_date DATE,
    amount DECIMAL(10,2)
);

-- 插入测试数据
INSERT INTO permission_test_schema.permission_test_sales_data VALUES 
    (1, 'Product A', date '2025-01-15', 1500.00),
    (2, 'Product B', date '2025-01-20', 2300.50),
    (3, 'Product C', date '2025-02-05', 800.75);
```

### 6.3 创建和授权角色

```sql
-- 创建角色
CREATE ROLE permission_test_developer_role;
CREATE ROLE permission_test_analyst_role;

-- 配置角色权限
-- 授予开发者角色更多权限
GRANT CREATE TABLE, CREATE VIEW ON SCHEMA permission_test_schema TO ROLE permission_test_developer_role;
GRANT SELECT, INSERT, UPDATE, DELETE, ALTER ON TABLE permission_test_schema.permission_test_sales_data TO ROLE permission_test_developer_role;

-- 授予分析师角色只读权限
GRANT SELECT ON TABLE permission_test_schema.permission_test_sales_data TO ROLE permission_test_analyst_role;

-- 将角色授予用户
GRANT ROLE permission_test_developer_role TO USER test01;
GRANT ROLE permission_test_analyst_role TO USER test02;
```

### 6.4 验证权限配置

```sql
-- 查看用户权限
SHOW GRANTS TO USER test01;
SHOW GRANTS TO USER test02;

-- 查看角色权限
SHOW GRANTS TO ROLE permission_test_developer_role;
SHOW GRANTS TO ROLE permission_test_analyst_role;
```

### 6.5 环境清理

```sql
-- 撤销角色权限
REVOKE ROLE permission_test_developer_role FROM USER test01;
REVOKE ROLE permission_test_analyst_role FROM USER test02;

-- 删除视图和表
DROP VIEW IF EXISTS permission_test_schema.permission_test_sales_view;
DROP TABLE IF EXISTS permission_test_schema.permission_test_sales_data;

-- 删除角色
DROP ROLE permission_test_developer_role;
DROP ROLE permission_test_analyst_role;

-- 删除Schema
DROP SCHEMA IF EXISTS permission_test_schema;

-- 移除用户
DROP USER test01;
DROP USER test02;

-- 验证用户是否已移除
SHOW USERS;
```

## 7. 最佳实践与注意事项

### 7.1 用户管理最佳实践

* **理解用户层级**：区分全局账号用户和服务实例用户，明确`CREATE USER`在工作空间中的实际作用。
* **用户创建前检查**：使用`SHOW USERS`确认用户是否已存在于工作空间中，避免冗余操作。
* **服务用户规范命名**：对于自动化流程的服务用户，建议以特定前缀命名，如`svc_`，以便区分。

### 7.2 角色管理最佳实践

* **遵循最小权限原则**：角色权限设计应遵循最小权限原则，只授予必要的权限。
* **角色层次设计**：设计层次化的角色结构，便于权限管理和维护。
* **角色命名规范**：采用规范的命名约定，如`[业务域]_[功能]_role`格式。

### 7.3 权限审计与维护

* **定期审计**：定期审查用户权限和角色分配，确保符合安全要求。
* **权限变更记录**：记录重要的权限变更操作，便于追溯。
* **测试验证**：权限变更后，使用相关用户身份测试验证权限是否正确生效。

## 8. 常见问题与解答

**Q1: 为什么在工作空间中创建用户时不需要指定密码**？

A1: 这是因为`CREATE USER`命令在工作空间中执行时，实际上是将已存在于服务实例中的用户添加到当前工作空间，是一种授权操作，而非真正创建新用户。用户的身份验证信息（如密码）是在全局账号层面管理的。

**Q2: 用户在一个工作空间被删除后，是否影响其在其他工作空间的访问**？

A2: 不影响。`DROP USER`命令只是将用户从当前工作空间移除，不影响用户在其他工作空间的权限和访问，也不会删除服务实例中的用户信息。

**Q3: 如何查看某个具体对象（如表）的所有授权情况**？

A3: 通过show grants on <对象名称>的语句查看。也可以通过查询information schema查看。

**Q4: 预置角色和自定义角色有什么区别**？

A4: 预置角色是系统自动配置的，不可删除，适合常见场景；自定义角色由用户创建，可灵活配置权限，适合特定业务需求。

**Q5: 一个用户可以同时拥有多个角色吗**？

A5: 可以。用户可以被授予多个角色，将获得这些角色的所有权限的并集。

## 9. 总结

云器Lakehouse的用户授权管理体系既强大又灵活，通过基于角色的访问控制模式，可以实现细粒度的权限管理。本指南通过理论解释和实践操作相结合的方式，全面介绍了从用户管理到权限审计的完整流程，帮助管理员更高效地管理数据访问安全。

在实际应用中，应当充分理解用户层级关系，合理规划角色和权限架构，定期进行权限审计，确保数据安全的同时提高授权管理效率。

***

*参考文档*

* [Lakehouse用户身份管理文档](user-identification.md)
* [Lakehouse角色权限管理文档](role-privlilige-manage.md)
* [安全功能概述](security_overview.md)

^
