# 使用Sqlline连接云器Lakehouse

## 概述

本文档旨在指导用户如何使用 Sqlline 工具连接到云器 Lakehouse，以便进行数据查询和管理。在开始操作之前，请确保满足以下前提条件。

## 前提条件

1. 您的本地计算机上已安装Java 8或更高版本。
2. 您已成功开通Lakehouse服务。
3. 您已下载 Lakehouse 提供的 Sqlline 组件。请点击 [此处](https://autolake-dev-beijing.oss-cn-beijing.aliyuncs.com/clickzetta-tool/release/sqlline_cz.tar.gz) 下载 sqlline_cz。

## 操作步骤

1. **解压 Sqlline 组件**：将下载的 sqlline_cz.tar.gz 文件解压到指定目录。
   ```
   tar vxf sqlline_cz.tar.gz
   ```

2. **进入工作目录**：打开终端，进入解压后的 sqlline_cz 目录。
   ```
   cd sqlline_cz
   ```

3. **初始化连接环境**：运行 `setup.sh` 脚本以初始化连接环境。
   ```
   sh setup.sh
   ```

4. **修改配置文件**：根据实际情况编辑 `example.properties` 文件，主要配置以下参数：
   - `url`: Lakehouse的JDBC URL。
   - `user`: Lakehouse的用户名。
   - `password`: Lakehouse的密码。

   例如，您可以使用文本编辑器修改配置文件：
   ```
   nano example.properties
   ```

   然后输入以下内容（替换为您的实际信息）：
   ```
   url=jdbc:lakehouse://your_lakehouse_url
   user=your_lakehouse_username
   password=your_lakehouse_password
   ```

5. **启动 Sqlline**：运行 Sqlline 并加载配置文件。
   ```
   ./sqlline property example.properties
   ```

## 使用示例

1. **查询数据表**：在 Sqlline 中，您可以执行 SQL 查询以查看数据表的内容。例如，查询名为 `employees` 的数据表：
   ```
   SELECT * FROM employees;
   ```

2. **创建数据表**：您可以使用 Sqlline 创建新的数据表。例如，创建一个名为 `departments` 的数据表：
   ```
   CREATE TABLE departments (
       id INT PRIMARY KEY,
       name VARCHAR(255),
       description TEXT
   );
   ```

3. **插入数据**：在数据表中插入数据。例如，向 `departments` 表中插入一条记录：
   ```
   INSERT INTO departments (id, name, description) VALUES (1, 'HR', 'Human Resources Department');
   ```

## 调试与问题排查

若需启用调试模式以输出详细日志，便于问题排查，请将环境变量 `SQLLINE_DEBUG_ENABLE` 设置为 `TRUE`：
```
export SQLLINE_DEBUG_ENABLE=TRUE
```

## 结语

通过以上步骤，您应已成功使用 Sqlline 连接到 Lakehouse 并进行数据操作。如有疑问或需要进一步支持，请随时联系我们的技术支持团队。