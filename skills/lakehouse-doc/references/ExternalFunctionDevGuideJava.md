# External Function 开发指南（Java）

本篇文档将介绍如何使用Java语言开发UDF、UDAF、UDTF类型的外部函数。
注：External Function 当前处于预览阶段，需要使用文档中说明的控制参数进行启用。

# UDF

云器 Lakehouse UDF 支持基于 Hive UDF API 规范开发函数，支持使用 GenericUDF (org.apache.hadoop.hive.ql.udf.generic.GenericUDF) 和 UDF (org.apache.hadoop.hive.ql.exec.UDF) 开发标量函数。

## 开发UDF

创建MAVEN项目，在pom.xml添加依赖。

```XML
<dependency>
    <groupId>org.apache.hive</groupId>
    <artifactId>hive-exec</artifactId>
    <version>2.3.8</version>
    <scope>provided</scope>
    <exclusions>
        <exclusion>
            <groupId>org.pentaho</groupId>
            <artifactId>*</artifactId>
        </exclusion>
    </exclusions>
</dependency>
```

编写UDF代码，示例如下：

```Java
package com.example;

import org.apache.hadoop.hive.ql.exec.UDFArgumentException;
import org.apache.hadoop.hive.ql.metadata.HiveException;
import org.apache.hadoop.hive.ql.udf.generic.GenericUDF;
import org.apache.hadoop.hive.serde2.objectinspector.ObjectInspector;
import org.apache.hadoop.hive.serde2.objectinspector.PrimitiveObjectInspector;
import org.apache.hadoop.hive.serde2.objectinspector.PrimitiveObjectInspector.PrimitiveCategory;
import org.apache.hadoop.hive.serde2.objectinspector.primitive.PrimitiveObjectInspectorFactory;
import org.apache.hadoop.hive.serde2.objectinspector.primitive.StringObjectInspector;

import java.util.Locale;

public class GenericUdfUpper extends GenericUDF {

  private StringObjectInspector soi;

  @Override
  public ObjectInspector initialize(ObjectInspector[] arguments) throws UDFArgumentException {
    checkArgsSize(arguments, 1, 1);
    checkArgPrimitive(arguments, 0);
    if (((PrimitiveObjectInspector) arguments[0]).getPrimitiveCategory() != PrimitiveCategory.STRING) {
      throw new UDFArgumentException("argument 0 requires to be string rather than " + arguments[0].getTypeName());
    }
    soi = (StringObjectInspector) arguments[0];
    return PrimitiveObjectInspectorFactory.javaStringObjectInspector;
  }

  @Override
  public Object evaluate(DeferredObject[] arguments) throws HiveException {
    Object arg = arguments[0].get();
    if (arg == null) {
      return null;
    }
    return soi.getPrimitiveJavaObject(arg).toUpperCase(Locale.ROOT);
  }

  @Override
  public String getDisplayString(String[] children) {
    return "upper";
  }
}
```

打包项目为 JAR 文件。

## 上传JAR文件到Volume中

将打包好的 JAR 文件上传至云器 Lakehouse 中创建的 External Volume 中。

首先，创建CONNECTION对象用于连接您已有的对象存储地址。

```SQL
--创建指向对象存储的服务连接定义
CREATE OR REPLACE STORAGE CONNECTION  qn_hz_bucket_ramrole
    TYPE oss
    REGION = 'cn-hangzhou'
    ROLE_ARN = 'acs:ram::1875653xxxxx:role/czudfrole'
    ENDPOINT = 'oss-cn-hangzhou-internal.aliyuncs.com';
```

其次，创建EXTERNAL VOLUME对象MOUNT对象存储的指定路径。

```SQL
--创建External Volume
CREATE EXTERNAL VOLUME qn_hz_bucket_vol
    location 'oss://qn-hz-bucket/'
    using connection qn_hz_bucket_ramrole
    directory = (
        enable=true,
        auto_refresh=false
    )
recursive=true;
```

最后使用本地 JDBC 客户端，连接工作空间并在本地客户端中使用 PUT 命令上传 JAR 文件（注：Studio Web-UI 的 SQL 编辑器中不支持使用 PUT 命令上传本地文件）。

```SQL
--上传打包后的UDF JAR
PUT '/Users/Downloads/upper.jar' TO  VOLUME qn_hz_bucket_vol FILE 'upper.jar';

--查看上传的文件
SHOW VOLUME DIRECTORY qn_hz_bucket_vol;

relative_path                                   url                                                                size last_modified_time  
----------------------------------------------- ------------------------------------------------------------------ ---- ------------------- 
data_parquet/data.csv                           oss://qn-hz-bucket/data_parquet/data.csv                           34   2024-05-29 17:03:25 
data_parquet/lakehouse_region_part00001.parquet oss://qn-hz-bucket/data_parquet/lakehouse_region_part00001.parquet 2472 2024-05-24 00:39:08 
upper.jar                                       oss://qn-hz-bucket/upper.jar                                       3161 2024-05-29 23:11:49 
```

您也可以指定内部volume。虽然您可以使用内部 Volume，但是您在创建 API CONNECTION 中的 code bucket 参数必须填写外部地址。

* **User Volume 格式地址**:`volume:user://~/upper.jar`
  * `user` 表示使用 User Volume 协议。

  * `~` 表示当前用户，为固定值。

  * `upper.jar` 表示目标文件名。
* **Table Volume 格式地址**`volume:table://table_name/upper.jar`
  * `table` 表示使用 Table Volume 协议。
  * `table_name` 表示表名，需根据实际情况填写。
  * `upper.jar` 表示目标文件名。

## 创建External Function

首先，创建函数计算服务Connection对象。

```SQL
create api connection qn_hz_fc_connection
type cloud_function 
with properties ( 
    'cloud_function.provider' = 'aliyun', 
    'cloud_function.region' = 'cn-hangzhou', 
    'cloud_function.role_arn' = 'acs:ram::1875653611111111:role/czudfrole', 
    'cloud_function.namespace' = 'default', 
    'cloud_function.code_bucket' = 'qn-hz-bucket'
);
```

其次，创建External Function，使用前面定义的Volume对象以读取JAR文件，使用已经定义的函数计算连接的CONNECTION对象用于调用函数计算服务创建一一对应的函数。

```SQL
create external function public.upper_udf 
as 'com.example.GenericUdfUpper' 
USING FILE 'volume://qn_hz_bucket_vol/upper.jar'
connection qn_hz_fc_connection
with properties ( 
         'remote.udf.api' = 'java8.hive2.v0',
          'remote.udf.protocol' = 'http.arrow.v0' 
);
```

## 测试运行

借助测试数据或表数据测试运行UDF。

```SQL
--测试运行UDF
select public.upper_udf('hello') as upper;
select public.upper_udf(product_id) from product_grossing limit 50;
```

具备阿里云控制台访问权限的用户，此时可以登录到阿里云函数计算控制台查看到CREATE EXTERNAL FUNCTION命令执行成功后，云器Lakehouse将自动创建函数以执行自定义函数。

执行 DROP FUNCTION public.upper_udf; 命令删除函数的同时，Lakehouse 平台将同步删除云服务商的对应函数。

# UDAF

支持基于 Hive 2.x UDAF 规范开发函数, 可使用 [GenericUDAFResolver](https://github.com/apache/hive/blob/branch-2.3/ql/src/java/org/apache/hadoop/hive/ql/udf/generic/GenericUDAFResolver.java) 和 [GenericUDAFEvaluator](https://github.com/apache/hive/blob/branch-2.3/ql/src/java/org/apache/hadoop/hive/ql/udf/generic/GenericUDAFEvaluator.java) 开发 UDAF;

UDAF 函数运行环境：

Java: 1.8 版本 (JDK 发行版由云厂商的函数计算服务运行环境提供)。

创建MAVEN项目，在pom.xml添加依赖。

```XML
<dependency>
    <groupId>org.apache.hive</groupId>
    <artifactId>hive-exec</artifactId>
    <version>2.3.8</version>
    <scope>provided</scope>
    <exclusions>
        <exclusion>
            <groupId>org.pentaho</groupId>
            <artifactId>*</artifactId>
        </exclusion>
    </exclusions>
</dependency>
```

## UDAF 开发

基于 GenericUDAFResolver 和 GenericUDAFEvalutor 编写 UDAF代码。

```SQL
package com.example;

import org.apache.hadoop.hive.ql.exec.UDFArgumentTypeException;
import org.apache.hadoop.hive.ql.metadata.HiveException;
import org.apache.hadoop.hive.ql.parse.SemanticException;
import org.apache.hadoop.hive.ql.udf.generic.AbstractGenericUDAFResolver;
import org.apache.hadoop.hive.ql.udf.generic.GenericUDAFEvaluator;
import org.apache.hadoop.hive.serde2.objectinspector.ObjectInspector;
import org.apache.hadoop.hive.serde2.objectinspector.PrimitiveObjectInspector;
import org.apache.hadoop.hive.serde2.objectinspector.PrimitiveObjectInspector.PrimitiveCategory;
import org.apache.hadoop.hive.serde2.objectinspector.primitive.IntObjectInspector;
import org.apache.hadoop.hive.serde2.objectinspector.primitive.PrimitiveObjectInspectorFactory;
import org.apache.hadoop.hive.serde2.typeinfo.PrimitiveTypeInfo;
import org.apache.hadoop.hive.serde2.typeinfo.TypeInfo;

public class sumint extends AbstractGenericUDAFResolver {

    @Override
    public GenericUDAFEvaluator getEvaluator(TypeInfo[] info) throws SemanticException {

        if (info.length != 1) {
            throw new UDFArgumentTypeException(info.length - 1, "Exactly one argument is expected.");
        }

        if (info[0].getCategory() != ObjectInspector.Category.PRIMITIVE) {
            throw new UDFArgumentTypeException(0, "Only primitive type arguments are accepted but " + info[0].getTypeName() + " was passed as parameter 1.");
        }

        if (((PrimitiveTypeInfo)info[0]).getPrimitiveCategory() == PrimitiveCategory.STRING) {
            return new SumStringEvaluator();
        } else if (((PrimitiveTypeInfo)info[0]).getPrimitiveCategory() == PrimitiveCategory.INT) {
            return new SumIntEvaluator();
        } else {
            throw new UDFArgumentTypeException(0, "Only string, int type arguments are accepted but " + info[0].getTypeName() + " was passed as parameter 1.");
        }
    }


    public static class SumStringEvaluator extends GenericUDAFEvaluator {

        private PrimitiveObjectInspector inputOI;

        static class SumAggregationBuffer implements AggregationBuffer {
            int sum;
        }

        @Override
        public ObjectInspector init(Mode m, ObjectInspector[] parameters) throws HiveException {
            super.init(m, parameters);

            inputOI = (PrimitiveObjectInspector) parameters[0];
            return PrimitiveObjectInspectorFactory.javaIntObjectInspector;
        }

        @Override
        public AggregationBuffer getNewAggregationBuffer() throws HiveException {
            SumAggregationBuffer sum = new SumAggregationBuffer();
            reset(sum);
            return sum;
        }

        @Override
        public void reset(AggregationBuffer agg) throws HiveException {
            ((SumAggregationBuffer) agg).sum = 0;
        }

        @Override
        public void iterate(AggregationBuffer agg, Object[] parameters) throws HiveException {
            if(parameters.length != 0 && inputOI.getPrimitiveJavaObject(parameters[0]) != null) {
                ((SumAggregationBuffer) agg).sum += Integer.parseInt(inputOI.getPrimitiveJavaObject(parameters[0]).toString());
            }
        }

        @Override
        public Object terminatePartial(AggregationBuffer agg) throws HiveException {
            return ((SumAggregationBuffer) agg).sum;
        }

        @Override
        public void merge(AggregationBuffer agg, Object partial) throws HiveException {
            ((SumAggregationBuffer) agg).sum += Integer.parseInt(inputOI.getPrimitiveJavaObject(partial).toString());
        }

        @Override
        public Object terminate(AggregationBuffer agg) throws HiveException {
            return ((SumAggregationBuffer) agg).sum;
        }

    }

    public static class SumIntEvaluator extends GenericUDAFEvaluator {

        private IntObjectInspector inputOI;

        static class SumAggregationBuffer implements AggregationBuffer {
            int sum;
        }

        @Override
        public ObjectInspector init(Mode m, ObjectInspector[] parameters) throws HiveException {
            super.init(m, parameters);

            inputOI = (IntObjectInspector) parameters[0];
            return PrimitiveObjectInspectorFactory.javaIntObjectInspector;
        }

        @Override
        public AggregationBuffer getNewAggregationBuffer() throws HiveException {
            SumAggregationBuffer sum = new SumAggregationBuffer();
            reset(sum);
            return sum;
        }

        @Override
        public void reset(AggregationBuffer agg) throws HiveException {
            ((SumAggregationBuffer) agg).sum = 0;
        }

        @Override
        public void iterate(AggregationBuffer agg, Object[] parameters) throws HiveException {
            ((SumAggregationBuffer) agg).sum += inputOI.get(parameters[0]);
        }

        @Override
        public Object terminatePartial(AggregationBuffer agg) throws HiveException {
            return ((SumAggregationBuffer) agg).sum;
        }

        @Override
        public void merge(AggregationBuffer agg, Object partial) throws HiveException {
            ((SumAggregationBuffer) agg).sum += inputOI.get(partial);
        }

        @Override
        public Object terminate(AggregationBuffer agg) throws HiveException {
            return ((SumAggregationBuffer) agg).sum;
        }

    }
}
```

## 上传JAR文件到Volume中

编译打包为 JAR，上传到用户指定的对象存储位置或 Lakehouse Volume 对象中。

```SQL
--上传打包后的UDF JAR
PUT '/Users/Downloads/sumint.jar' TO  VOLUME qn_hz_bucket_vol FILE 'sumint.jar';

--查看上传的文件
SHOW VOLUME DIRECTORY qn_hz_bucket_vol;

relative_path url                           size last_modified_time  
------------- ----------------------------- ---- ------------------- 
upper.jar     oss://qn-hz-bucket/upper.jar  3161 2024-05-29 23:11:49 
sumint.jar    oss://qn-hz-bucket/sumint.jar 1022 2024-05-30 01:10:28 
```

## 创建External Function

1.  创建与函数计算服务连接的 Connection 对象（参见 UDF 中的介绍）
2. 在 LakeHouse 系统中创建外部函数

UDAF的 External Function创建语法说明：

```SQL
CREATE EXTERNAL FUNCTION public.<funcName>
    AS '<className>'
    USING FILE 'oss://<bucket>/<pathToJar>'
    CONNECTION <connectionName>
    WITH PROPERTIES (
        'remote.udf.api' = 'java8.hive2.v0', 
        'remote.udf.category' = 'AGGREGATOR');
```

参数说明:

1. functionName: 可使用任意合法标识符, 比如 my\_agg
2. className: 填写第 1 步中开发的 GenericUDAFResolver 的完整类名, 比如 com.example.GenericUDAFSum;
3. bucket 和 pathToJar: 填写第 2 步上传到 OSS 的存储桶和对象路径;
4. connectionName: 使用第 3 步创建的 connection 的名字, 比如 udf\_deploy\_0317;
5. 最后两个 PROPERTIES 保持原样即可;

示例如下：

```SQL
--创建External Function
create external function public.sumint
as 'com.example.sumint' 
USING FILE 'volume://qn_hz_bucket_vol/sumint.jar'
connection qn_hz_fc_connection
with properties ( 
         'remote.udf.api' = 'java8.hive2.v0',
         'remote.udf.category' = 'AGGREGATOR'
);
```

## 测试运行

借助测试数据或表数据测试运行 UDF。注：当前需要通过 cz.sql.remote.udf.enabled 参数开启远程函数访问。

```SQL
--测试运行UDF
set cz.sql.remote.udf.enabled = true;
select public.sumint(amount) from product_grossing;
```

# UDTF

## UDTF 开发

支持继承org.apache.hadoop.hive.ql.udf.generic.GenericUDTF进行UDTF开发。UDTF需要实现initialize, process, close三个方法。UDTF首先会调用initialize方法，此方法返回UDTF的返回行的信息（返回个数，类型）。初始化完成后，会调用process方法，对传入的参数进行处理，可以通过forword()方法把结果返回。最后close()方法调用，对需要清理的方法进行清理。

编写UDTF代码，示例如下：

```Java
package com.example;

import org.apache.hadoop.hive.ql.exec.UDFArgumentException;
import org.apache.hadoop.hive.ql.metadata.HiveException;
import org.apache.hadoop.hive.ql.udf.generic.GenericUDTF;
import org.apache.hadoop.hive.serde2.objectinspector.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

public class MyExplode extends GenericUDTF {

    private static Logger logger = LoggerFactory.getLogger(MyExplode.class);
    private ObjectInspector oi;
    private Object[] params;

    @Override
    public StructObjectInspector initialize(ObjectInspector[] argOIs) throws UDFArgumentException {

        oi = argOIs[0];
        final ObjectInspector.Category category = oi.getCategory();

        List<String> names = new ArrayList<>(2);
        List<ObjectInspector> types = new ArrayList<>(2);
        switch (category){

            case MAP:
                logger.info("receive explode category : Map");
                names.add("key");
                names.add("value");
                final MapObjectInspector moi = (MapObjectInspector) this.oi;
                types.add(moi.getMapKeyObjectInspector());
                types.add(moi.getMapValueObjectInspector());
                params = new Object[2];
                break;
            case LIST:
                logger.info("receive explode category : List");
                names.add("value");
                final ListObjectInspector loi = (ListObjectInspector) oi;
                types.add(loi.getListElementObjectInspector());
                params = new Object[1];
                break;
            default:
                throw new UDFArgumentException("not supported category for function explode : " + category);
        }
        return ObjectInspectorFactory.getStandardStructObjectInspector(names,types);
    }

    @Override
    public void process(Object[] args) throws HiveException {

        if (args.length != 1 || Objects.isNull(args[0])){


            throw new HiveException("Only 1 nonnull arg supported for function explode, but got " + args.length);
        }
        ObjectInspector.Category category = oi.getCategory();
        switch(category){

            case MAP:
                final Map<?, ?> map = ((MapObjectInspector) oi).getMap(args[0]);
                final Iterator<? extends Map.Entry<?, ?>> it = map.entrySet().iterator();
                while(it.hasNext()){

                    final Map.Entry<?, ?> entry = it.next();
                    params[0] = entry.getKey();
                    params[1] = entry.getValue();
                    forward(params);
                }
                break;
            case LIST:
                final List<?> list = ((ListObjectInspector) oi).getList(args[0]);
                final Iterator<?> itl = list.iterator();
                while (itl.hasNext()) {


                    params[0] = itl.next();
                    forward(params);
                }
                break;
        }
    }

    @Override
    public void close() throws HiveException {

        oi = null;
        for (int i = 0; i < params.length; i++) {
            params[i] = null;
        }
        params = null;
    }
}
```

## 上传JAR文件到Volume中

编译打包为 JAR，上传到用户指定的对象存储位置或 Lakehouse Volume 对象中。

```SQL
--上传打包后的UDF JAR
PUT '/Users/Downloads/MyExplode.jar' TO  VOLUME qn_hz_bucket_vol FILE 'MyExplode.jar';
```

## 创建External Function

1.  创建与函数计算服务连接的 Connection 对象（参见 UDF 中的介绍）
2. 在 LakeHouse 系统中创建外部函数

UDTF的External Function创建语法说明：

```SQL
CREATE EXTERNAL FUNCTION public.<funcName>
    AS '<className>'
    USING FILE 'oss://<bucket>/<pathToJar>'
    CONNECTION <connectionName>
    WITH PROPERTIES (
        'remote.udf.api' = 'java8.hive2.v0', 
        'remote.udf.category' = 'TABLE_VALUED');
```

参数说明:

1. functionName: 可使用任意合法标识符, 比如 my\_udtf
2. className: 填写第 1 步中开发的 GenericUDTF 的完整类名, 比如 com.example.MyGenericUDTF;
3. bucket 和 pathToJar: 填写第 2 步上传到 OSS 的存储桶和对象路径;
4. connectionName: 使用第 3 步创建的 connection 的名字, 比如 my\_function\_conn;
5. 最后两个 PROPERTIES 保持原样即可;

^
