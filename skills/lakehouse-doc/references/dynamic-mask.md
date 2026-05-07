# Lakehouse 列级安全（动态脱敏）使用文档
> 【预览发布】本功能当前处于受邀预览发布阶段。如需使用，请联系我们的技术支持团队协助处理。
## 1. 概述

列级安全（Column-level Security）通过动态脱敏（Dynamic Data Masking）提供细粒度数据保护能力，可根据用户身份或角色动态修改敏感数据的显示方式（如部分隐藏、替换字符）。系统仅存储原始数据，在数据读取运行时才执行脱敏函数（mask function）。本文档介绍如何通过 SQL 接口实现此功能。

## 2. 核心语法

### 2.1 创建脱敏策略函数

参考[CREATE FUNCTION(SQL)](create-sql-function.md)语法

```sql
CREATE  FUNCTION [schema_name.]function_name (col_name column_type) 
RETURNS output_type 
AS 
expression_with_conditional_logic;
```

**关键要素**：

* 必须返回与原始列相同的数据类型
* 使用安全上下文函数：
  * `current_user()` 获取当前用户（注意大小写）
  * `current_roles()` 获取用户角色数组

### 2.2 绑定策略到列

**创建表时指定**：

```sql
CREATE TABLE table_name (
  col1 STRING MASK schema_name.masking_function,
  ...
);
```

**修改已有表**：

```sql
ALTER TABLE table_name 
CHANGE COLUMN column_name 
SET MASK schema_name.masking_function;
```

**添加列时指定脱敏**：

```SQL
ALTER TABLE table_nameADD COLUMN (column_name column_typeMASK schema_name.masking_function);
```

### 2.3 解除策略绑定

```sql
ALTER TABLE table_name 
CHANGE COLUMN column_name 
UNSET MASK;
```

***

## 3. 使用场景示例

### 3.1 基础脱敏

**需求**：身份证号前6位+4星号+后4位

```sql
CREATE FUNCTION public.idcard_masking(idcard STRING)
RETURNS STRING
AS concat(substr(idcard, 1, 6), repeat('*', 4), substr(idcard, 10, 4));

ALTER TABLE data CHANGE COLUMN idcard SET MASK public.idcard_masking;
```

**查询效果**：

```
原始值：130183199901011234 → 脱敏后：130183****9010
```

### 3.2 基于用户的动态脱敏

**需求**： 仅UAT\_TEST用户看到脱敏数据

```sql
CREATE FUNCTION public.idcard_masking(idcard STRING)
RETURNS STRING
AS 
CASE 
  WHEN current_user() = "UAT_TEST" 
  THEN concat(substr(idcard, 1, 6), repeat('*', 4), substr(idcard, 10, 4))
  ELSE idcard 
END;
--忽略用户名大小写
CREATE FUNCTION public.idcard_masking(idcard STRING)
RETURNS STRING
AS 
CASE 
  WHEN lower(current_user()) = "uat_test" 
  THEN concat(substr(idcard, 1, 6), repeat('*', 4), substr(idcard, 10, 4))
  ELSE idcard 
END;
```

### 3.3 基于角色的动态脱敏

**需求**： user\_admin角色可查看完整信息

```sql
CREATE FUNCTION public.idcard_masking_role(idcard STRING)
RETURNS STRING
AS 
CASE 
  WHEN array_contains(current_roles(), "user_admin") 
  THEN idcard
  ELSE concat(substr(idcard,1,6), '****', substr(idcard,11,4)) 
END;
```

***

## 4. 完整操作示例

### 4.1 初始化环境

```sql
CREATE SCHEMA IF NOT EXISTS security_demo;
USE security_demo;
-- 通用掩码函数
CREATE FUNCTION security_demo.ssn_mask(ssn STRING)
RETURNS STRING
AS concat('***-**-', substr(ssn, 8, 4));

CREATE TABLE security_demo.user_data (
  name STRING,
  ssn STRING MASK security_demo.ssn_mask,  -- 建表时直接绑定
  phone STRING
);
INSERT INTO security_demo.user_data VALUES('James', '123-45-6789','123456789');
SELECT * FROM      security_demo.user_data;
```

### 4.2 创建策略函数

```sql
-- 特权角色豁免
CREATE FUNCTION security_demo.admin_ssn_mask(ssn STRING)
RETURNS STRING
AS 
CASE
  WHEN array_contains(current_roles(), 'user_admin') THEN ssn
  ELSE concat('***-**-', substr(ssn,8,4))
END;
```

### 4.3 修改脱敏策略

```sql
--去除之前的策略
ALTER TABLE security_demo.user_data CHANGE COLUMN ssn UNSET MASK;

--添加新的策略
ALTER TABLE security_demo.user_data CHANGE COLUMN ssn SET MASK security_demo.admin_ssn_mask;
```

### 4.4 验证效果

**普通用户查询**：

```sql
SELECT * FROM user_data;
-- 输出：John Doe ***-**-6789 138****1234
```

**USER\_ADMIN角色查询**：

```sql
SELECT * FROM user_data; 
-- 输出：John Doe 123-45-6789 138****1234
```

***

## 5. 管理注意事项

### 5.1 权限控制

* 仅允许具有 `ALTER TABLE` 权限的角色修改脱敏策略。
* 函数创建需要 `CREATE FUNCTION` 权限。

### 5.2 性能建议

* 避免在脱敏函数中使用复杂计算。
* 对高频查询列，谨慎使用条件判断逻辑。

## 6. 限制说明

* 单个列只能绑定一个脱敏策略。如果您想定义多种脱敏规则，可以在一个函数中基于条件判断实现不同的策略。

^
