# 使用流程: External Function

## 文档目标：

通过本篇使用流程，您可以实现：

* 调用JAVA NLP 的离线模型（详见[网址](https://github.com/Ruthwik/Sentiment-Analysis)），解析云器Lakehouse 表中字符串的情绪
* 调用阿里云视觉智能开放平台服务（详见[网址](https://help.aliyun.com/document_detail/203520.htm?spm=a2c4g.601126.0.0.39de5a4eqBtLaC)），解析云器Lakehouse 表中 url 指向的图片数据

（本篇最佳实践使用的环境为基于阿里云的云器 Lakehouse。）

## 操作步骤:

### Step0：准备工作（授权操作）

本步骤目标是：允许云器 Lakehouse 集群访问客户侧的阿里云上的函数计算 FC、对象存储服务 (OSS)。为了完成这个目标，需要创建一个角色，让云器 Lakehouse 扮演这个角色去访问阿里云上的函数计算 FC 和 OSS 服务。

#### 1. 阿里云控制台：在阿里云控制台**访问控制**(RAM)中创建权限策略 (如：CzUdfOssAccess )：

* 进入阿里云 RAM 控制台
* 左侧导航栏 **权限管理** -> **权限控制**，在**权限控制**界面选择**创建权限策略**
* 在**创建权限策略**页面选择**脚本编辑**页签（将下面 [] 中的 bucket 名称替换）。

```JSON
{
    "Version": "1",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "oss:GetObject",
                "oss:PutObject",
                "oss:DeleteObject"
            ],
            "Resource": [
                "acs:oss:*:*: [bucket_name]/*",
                "acs:oss:*:*:[bucket_name]/*"
            ]
        }
    ]
}
```

^

#### 2. 阿里云控制台：在阿里云 RAM 中创建角色（如：CzUDFRole）：

* 在RAM 控制台左侧导航栏 **身份管理** -> **角色**，点击**创建角色**
* 在**创建角色**页面中，选择类型为**阿里云账号**，在配置角色中填写自定义**角色名称**（如 CzUDFRole），在**选择信任的云账号**中选择**其他云账号**，并写入：1384322691904283（云器 Lakehouse 上海的云主账号），点击**完成**。
* 编辑**AliyunFCFullAccess 权限策略**，添加下面 "acs:Service": "fc.aliyuncs.com" 部分。

```Properties
{
    "Version": "1",
    "Statement": [
        {
            "Action": "fc:*",
            "Resource": "*",
            "Effect": "Allow"
        },
        {
            "Action": "ram:PassRole",
            "Resource": "*",
            "Effect": "Allow",
            "Condition": {
                "StringEquals": {
                    "acs:Service": "fc.aliyuncs.com"
                }
            }
        }
    ]
}
```

* 创建完成之后，点击**为角色授权**:
* 在**系统策略**中，将**AliyunFCFullAccess**策略授权给该角色 CzUDFRole。
* 在**自定义策略**中，将刚创建的策略（**CzUdfOssAccess**）授权给该角色。

#### 3. 在角色 CzUDFRole 详情页中，获取该角色的 RoleARN 信息：

* 修改 CzUDFRole 的**信任策略**：

```Python
{
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Effect": "Allow",
      "Principal": {
        "RAM": [
          "acs:ram::1384322691904283:root"
        ],
        "Service": [
          "fc.aliyuncs.com"
        ]
      }
    }
  ],
  "Version": "1"
}
```

***

### 场景1: 调用JAVA NLP 的离线模型：

#### &#x20;1. 编写代码

* 基于 Hive UDF API 编写 UDF，以下是实现大小写转换的示例代码:

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

* 编译代码生成 Jar 包和其他依赖文件，打包成 zip 压缩包

#### 2. 上传函数程序包到指定路径

如： `oss://hz-oss-lakehouse/functions/sentiment/UDF_code/SentimentAnalysis.zip`

函数主类：`com.clickzetta.nlp.GenericUDFSentiment`

有两种方法上传文件到指定路径：

* 通过 OSS 客户端直接上传&#x20;
* 在Lakehouse JDBC 客户端（不支持Lakehouse Web UI 使用 PUT 命令上传）通过 [PUT 命令](PUT.md) 将程序包上传至 [Volume对象](datalake_volume.md)，并在创建函数 DDL 中引用 volume 路径。例如：

```
-- 上传文件到命名为 fc_volume 的 Volume对象：
PUT ./SentimentAnalysis.zip to volume fc_volume/udfs/SentimentAnalysis.zip;

-- 在创建函数时引用该 Volume 路径：
create external function public.sentiment_demo_hz
    AS 'com.clickzetta.nlp.GenericUDFSentiment' 
    USING ARCHIVE 'volume://fc_volume/udfs/SentimentAnalysis.zip' 
    CONNECTION udf_sentiment_bj
    WITH
    PROPERTIES (
        'remote.udf.api' = 'java8.hive2.v0'
);

```

您也可以指定内部 volume。虽然您可以使用内部 volume，但是在创建 API CONNECTION 中的 code_bucket 参数必须填写外部地址。

* **User Volume 格式地址**:`volume:user://~/upper.jar`
  * `user` 表示使用 User Volume 协议。

  * `~` 表示当前用户，为固定值。

  * `upper.jar` 表示目标文件名。
* **Table Volume 格式地址**`volume:table://table_name/upper.jar`
  * `table` 表示使用 Table Volume 协议。
  * `table_name` 表示表名，需根据实际情况填写。
  * `upper.jar` 表示目标文件名。

#### 3. 新建连接（Connection）

```SQL
create api connection udf_sentiment_bj
type cloud_function 
provider = 'aliyun'
region = 'cn-beijing'
role_arn = 'acs:ram::1222808864467016:role/czudfrole'
namespace = 'default'
code_bucket = 'derek-bj-oss';
```

**参数解释**：

1. **api_connection**：创建 API 类型的 Connection，用于调用第三方的服务接口；

2. **type**: 连接类型为云函数：cloud\_function，其中具体的属性为：

* provider：云函数提供商，如 aliyun
* region：云函数所在区域，如'cn-shanghai'
* role\_arn：创建云函数所扮演的角色，如 acs\:ram::12228000000000000\:role/czudfrole
* code\_bucket：云函数程序文件所在路径的对象存储 bucket 名称

#### 4.在 Lakehouse 创建 External Function

```SQL
create external function public.sentiment_demo_hz 
as 'com.clickzetta.nlp.GenericUDFSentiment' 
using archive 'oss://hz-oss-lakehouse/functions/sentiment/UDF_code/SentimentAnalysis.zip'
connection udf_sentiment_hz 
with properties ( 
 'remote.udf.api' = 'java8.hive2.v0', 
);
```

**参数解释**：

1. **as**：后面跟的是 Java 函数的主类名
2. **using**：仅支持编译后的 Java 程序。后面需要接参数 **archive** 表示程序包为 zip 格式的文件；**jar** 表示 Java 程序的 jar 包文件。后面可直接引用文件的 OSS 路径；如果文件已通过[PUT 命令](PUT.md)上传至 [Volume对象](datalake_volume.md)，也可以通过 Volume 路径直接引用函数文件，例如：`USING ARCHIVE 'volume://fc_volume/udfs/SentimentAnalysis.zip' `
3. **connection**：表示程序中使用的 connection 对象，如 udf\_sentiment\_bj；其中属性信息：

* remote.udf.api：java UDF 请填写为 java8.hive2.v0

#### 5. 执行语义情感分析：

**构造测试数据**：

```SQL
create table tbl_wisdom_nlp(id int, qoute string);

insert into tbl_wisdom_nlp values(1,"Honesty and diligence should be your eternal mates");
insert into tbl_wisdom_nlp values(2,"If a man deceives me once, shame on him; if twice,shame on me");
insert into tbl_wisdom_nlp values(3,"I am so damn happy");
insert into tbl_wisdom_nlp values(4,"Today is Sunday");
insert into tbl_wisdom_nlp values(5,"Today is Monday");
```

**执行语义分析**：

```SQL
set cz.sql.remote.udf.enabled = true;
select qoute, public.sentiment_demo(qoute) as sentiment from tbl_wisdom_nlp;
```

## 场景2：Python UDF：调用第三方视觉处理平台 API 做图像解析

#### 1. 代码文件为 video\_contents.py：

```Python
from alibabacloud_imagerecog20190930.client import Client
from alibabacloud_imagerecog20190930.models import RecognizeFoodRequest
from alibabacloud_tea_openapi.models import Config
from alibabacloud_tea_util.models import RuntimeOptions

from cz.udf import annotate

@annotate("string->string")
class image_to_text(object):

    def evaluate(self,url):
        if url is None:
            return None
        try:
            config = Config(
                access_key_id='xxxxx',
                access_key_secret='xxxxxxxx',
                endpoint='imagerecog.cn-shanghai.aliyuncs.com',
                region_id='cn-shanghai'
            )
            # Initialize a request and set parameters
            
            client = Client(config)
            recognize_food_request = RecognizeFoodRequest(image_url=url)
            runtime = RuntimeOptions()
            response = client.recognize_food_with_options(recognize_food_request, runtime)

            if len(str(response.body)) >= 1:
                return str(response.body)
            else:
                return ""
        except Exception as exc:
            return "[error] " + exc.__str__()
        finally:
            pass

#if __name__ == "__main__":
#   import sys
#    to_text = image_to_text()
#    for url in sys.argv[1:]:
#        print(f"{to_text.evaluate(url)}")
```

#### 2. 复用*场景一*中的 connection

#### 3. 新建 External Function

```Python
create external function public.image_to_text
as 'video_contents.image_to_text'    # 脚本名称 + 类名称
using archive 'oss://derek-bj-oss/bj_remote_udf/image_to_text/image_to_text.zip'
connection udf_sentiment_bj2
with properties (
 'remote.udf.api' = 'python3.mc.v0',   
);
```

**参数解释**:

1. As 后面为python 模块名 + 主类名，如主程序文件为 video\_contents.py，主类名为 image\_to\_text，as 后的参数为`'video_contents.image_to_text'`
2. **using archive / file**：py 文件需打包为 zip 格式的文件；同时支持单文件脚本，用 file 参数指定

* **connection**：表示程序中使用的 connection 对象，如 udf\_sentiment\_bj；其中属性信息：

  * remote.udf.api：Python 语言函数请填写 python3.mc.v0

#### 4. 建测试数据验证

将以下4个图片导入到 OSS 中，并生成 public url 存储到 Lakehouse 表中。可以直接用以下 SQL 构造测试表：

```SQL
create table tbl_images(id int, url string);

insert into tbl_images values(1,'http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood1.jpg');
insert into tbl_images values(2,'http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood2.jpg');
insert into tbl_images values(3,'http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood3.jpg');
insert into tbl_images values(4,'http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood4.jpg');
```

执行查询：

```SQL
set cz.sql.remote.udf.enabled = true;
select id, public.image_to_text(url) from tbl_images;
```

***

^
