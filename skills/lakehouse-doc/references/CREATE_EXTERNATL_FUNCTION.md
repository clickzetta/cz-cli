# CREATE EXTERNAL FUNCTION

外部函数（EXTERNAL FUNCTION）是云器 Lakehouse 提供的强大功能，允许您通过 Python 和 Java 语言创建自定义函数（UDF），并通过远程云服务执行。这种灵活性使您能够扩展 Lakehouse 的计算能力，处理复杂的业务逻辑。支持以下云服务平台执行外部函数：

* 阿里云函数计算（FC）
* 腾讯云云函数服务
* AWS Lambda 服务

支持开发语言：

* Python 3.10
* Java 8

对于以下三种不同类型的自定义函数：

* UDF（用户自定义函数）：处理输入行中的一个或多个列，并为每一行返回单个结果值。
* UDAF（用户自定义聚合函数）：对多行数据进行聚合计算，返回单个结果值。
* UDTF（用户自定义表函数）：接收一个或多个输入参数，返回多行多列的结果集。

Python 函数支持 UDF，Java 函数支持 UDF、UDAF 和 UDTF

## EXTERNAL FUNCTION 创建主要流程

* 用户开通云上的函数计算服务（如阿里云的函数计算FC）和对象存储服务

* 将 EXTERNAL FUNCTION 执行代码、可执行文件、依赖的库、模型和数据文件，打包上传至对象存储

* 授予云器 Lakehouse 操作上述服务和访问函数文件的权限

* 用户执行连接和 EXTERNAL FUNCTION DDL 创建函数

* 用户在云器 Lakehouse SQL 语句中使用函数

* 云器 Lakehouse 根据提供的服务地址和认证信息发送 HTTP 请求调用运行函数

* 云器 Lakehouse 获取响应信息返回结果

## EXTERNAL FUNCTION 优势

* 可以使用 EXTERNAL FUNCTION 调用外部丰富的数据处理能力，对传统 SQL 计算模型做补充。如可调用大语言模型（LLM）、图像、音视频等，补充 SQL 的非结构化数据处理能力
* 可以直接访问外部网络，不受云器 Lakehouse 网络约束

## 语法

```SQL
CREATE EXTERNAL FUNCTION [ IF NOT EXISTS ] [<database_name>.]<schema_name>.<function_name>
  AS <class_name>
  USING { FILE | JAR | ARCHIVE } = '<resource_uri>'[, ...]
  CONNECTION = <api_connection_name>
  WITH PROPERTIES ( '<property_name>' = '<property_value>'[, ...] )
  [ COMMENT  '<comment_string>' ]
```

## 参数说明

### 必选参数

* `function_name`: 指定函数的名称。

* `class_name`：对于 JAVA 函数，指 JAVA 函数的主类名；对于 Python 函数，为主类名和模块名的组合，例如，主程序文件为 `video_contents.py`，主类名为 `image_to_text`，AS 后的参数为 `'video_contents.image_to_text'`。

* `api_connection_name`：指定连接函数计算的认证信息，具体请参考[创建连接](CREATECONNECTION.md)。

* `resource_uri`：资源连接，指 EXTERNAL FUNCTION 运行所需的资源文件。需指定对应的文件地址，要求认证信息（API CONNECTION 或者内部 VOLUME）具有该文件的读取权限。您也可以指定内部 VOLUME 如 USER VOLUME 和 TABLE VOLUME 存放代码包，这样您无需再去开通云对象存储服务。虽然您可以使用内部 volume 存放函数程序包，但是您在创建 API CONNECTION 中的 code bucket 参数必须填写外部对象存储的 BUCKET 名称。
  * **External** **Volume 格式地址**：`volume://[{workspace}.][{schema}.]{volume_name}/upper.jar`
    * `workspace` 和 `schema` 是可选项，如果省略，将使用当前上下文默认值。
  * **User Volume 格式地址**：`volume:user://~/upper.jar`
    * `user` 表示使用 User Volume 协议。
    * `~` 表示当前用户，为固定值。
    * `upper.jar` 表示目标文件名。
  * **Table Volume 格式地址**：`volume:table://[{workspace}.][{schema}.]{table_name}/upper.jar`
    * `workspace` 和 `schema` 是可选项，如果省略，将使用当前上下文默认值。
    * `table` 表示使用 Table Volume 协议。
    * `table_name` 表示表名，需根据实际情况填写。
    * `upper.jar` 表示目标文件名。

* `WITH PROPERTIES`：指定函数的参数信息。
  1. `remote.udf.api` - 指定运行时编译环境，支持两种选项：

     * `python3.mc.v0`：当使用 Python UDF 时需要指定此选项
     * `java8.hive2.v0`：当使用 JAVA Hive 风格 UDF 时需要指定此选项
  2. `remote.udf.protocol` - 指定访问协议，默认值为`http.arrow.v0`，代表访问云函数的协议

### 可选参数

* `IF NOT EXISTS`：如果指定的函数已存在，则命令不会进行任何更改并返回一条指示函数存在的信息。如果不指定，函数存在时会直接返回错误信息。
* `COMMENT`：指定注释信息。

## 注意事项

* 创建外部函数过程需要读取函数代码或可执行文件，可能需要较长时间。
* 该命令无需启动 VC，因此不消耗 CRU。
* 目前只支持 Java 和 Python 编程语言，支持的运行环境：Java 8 和 Python 3.10 版本

# 开发指南

* [创建 API CONNECTION](create-api-connection.md)
* [Java 语言开发 External Function 指南](ExternalFunctionDevGuideJava.md)
* [Python 语言开发 External Function指南](RemoteFunctionDevGuidePython3.md)

# 使用示例

## 阿里云创建 EXTERNAL FUNCTION

**环境依赖**：系统已经创建 API CONNECTION，请参考 [API CONNECTION](create-api-connection.md)

**步骤 1**：JAVA 语言编写 EXTERNAL FUNCTION，以下是实现大小写转换的示例代码：

```java
package com.example;

import org.apache.hadoop.hive.ql.exec.UDFArgumentException;
import org.apache.hadoop.hive.ql.metadata.HiveException;
import org.apache.hadoop.hive.ql.udf.generic.GenericUDF;
import org.apache.hadoop.hive.serde2.objectinspector.ObjectInspector;
import org.apache.hadoop.hive.serde2.objectinspector.PrimitiveObjectInspector;
import org.apache.hadoop.hive.serde2.objectinspector.PrimitiveObjectInspector.PrimitiveCategory;
import org.apache.hadoop.hive.serde2.objectinspector.primitive.PrimitiveObjectInspectorFactory;

import java.util.Locale;

public class GenericUdfUpper extends GenericUDF {
  @Override
  public ObjectInspector initialize(ObjectInspector[] arguments) throws UDFArgumentException {
    checkArgsSize(arguments, 1, 1);
    checkArgPrimitive(arguments, 0);
    if (((PrimitiveObjectInspector) arguments[0]).getPrimitiveCategory() != PrimitiveCategory.STRING) {
      throw new UDFArgumentException("argument 0 requires to be string rather than " + arguments[0].getTypeName());
    }
    return PrimitiveObjectInspectorFactory.javaStringObjectInspector;
  }

  @Override
  public Object evaluate(DeferredObject[] arguments) throws HiveException {
    Object arg = arguments[0].get();
    if (arg == null) {
      return null;
    }
    return ((String) arg).toUpperCase(Locale.ROOT);
  }

  @Override
  public String getDisplayString(String[] children) {
    return "upper";
  }
}
```

编译代码生成 **Jar 包和其他依赖文件**，打包成 zip 压缩包

**步骤 2**：上传函数程序包到指定路径
如： `oss://hz-oss-lakehouse/functions/sentiment/UDF_code/my_upper.zip`
函数主类：`com.clickzetta.my_upper`
有两种方法上传文件到指定路径：

* 通过 OSS 客户端直接上传
* 在 Lakehouse JDBC 客户端（不支持 Lakehouse Web UI 使用 PUT 命令上传）通过 [PUT 命令](PUT.md) 将程序包上传至 [Volume 对象](datalake_volume.md)，并在创建函数 DDL 中引用 VOLUME 路径和上面创建的 API CONNECTION。例如：

```SQL
-- 上传文件到命名为 fc_volume 的 Volume对象：
PUT './my_upper.zip' to volume fc_volume file '/udfs/my_upper.zip';

-- 在创建函数时引用该 Volume 路径：
create external function public.my_upper
    AS 'com.clickzetta.my_upper' 
    USING ARCHIVE 'volume://fc_volume/udfs/my_upper.zip' 
    CONNECTION my_function_connection
    WITH
    PROPERTIES (
        'remote.udf.api' = 'java8.hive2.v0'
);
```

**步骤 3**：使用函数

```SQL
SELECT public.my_upper('a');
```

**说明**：

如果您使用 USER VOLUME 替换**步骤 2** 中的 OSS 路径，USER VOLUME 为云器 Lakehouse 默认提供的个人文件存储空间（类似于操作系统的用户 HOME 目录）

```SQL
-- 查看 USER VOLUME
SHOW USER VOLUME DIRECTORY;

-- 上传文件至 USER VOLUME
-- !!! 注意：
-- 1. 需使用 Lakehouse JDBC 客户端工具执行 PUT 命令，文件路径为本地路径。
-- 2. 必须使用包含依赖的 JAR 包
PUT '/Users/nero/Downloads/udf/expudf-1.0-SNAPSHOT-jar-with-dependencies.jar' TO USER VOLUME;

-- 删除已存在的函数定义（如有）
DROP FUNCTION IF EXISTS public.eval_exp_internal_volume;

-- 创建外部函数
CREATE EXTERNAL FUNCTION public.eval_exp_internal_volume
AS 'com.clickzetta.hive.udf.EvalExpUdf' 
USING FILE 'volume:user://~/expudf-1.0-SNAPSHOT-jar-with-dependencies.jar' 
CONNECTION udf_api_conn
WITH PROPERTIES (
    'remote.udf.api' = 'java8.hive2.v0'
);

-- 测试函数：返回字符串结果
SELECT public.eval_exp_internal_volume(
    named_struct('a', 1d, 'b', 4.3d, 'c', 3d), 
    '(a+b)/c'
).string_result;

-- 测试函数：返回浮点数结果
SELECT public.eval_exp_internal_volume(
    named_struct('a', 1d, 'b', 4.3d, 'c', 3d), 
    '(a+b)/c'
).double_result;
```

^
