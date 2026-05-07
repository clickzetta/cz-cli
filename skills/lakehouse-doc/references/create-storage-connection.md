# 创建STORAGE CONNECTION

Storage Connection 主要用于存储第三方存储服务的身份认证信息，使 Lakehouse 能够安全地访问和管理这些存储服务中的数据。

* 目前支持对象存储、Kafka、HDFS。其中对象存储包括腾讯云COS、阿里云OSS和AWS S3。
* 目前不支持跨云厂商创建。比如您的 Lakehouse 实例运行在阿里云上，无法访问腾讯云的 COS 数据。

## 创建阿里云存储连接

本步骤的目标是：允许 Lakehouse 实例通过 VOLUME 对象，处理阿里云对象存储 OSS 中的数据。为了完成这个目标，可以通过阿里云提供的两种身份认证方式：**访问密钥** 和 **角色授权**。

### 基于AK密钥方式：

仅需提供带有访问 OSS 权限的账号的 AccessKey ID 和 AccessKey Secret 信息，利用这些信息创建存储连接 (Storage Connection) 对象，示例如下：

```
CREATE STORAGE CONNECTION if not exists hz_conn_ak
    TYPE oss
    ENDPOINT = 'oss-cn-hangzhou.aliyuncs.com'
    ACCESS_ID = 'LTAI5tMmbq1Ty1xxxxxxxxx'
    ACCESS_KEY = '0d7Ap1VBuFTzNg7gxxxxxxxxxxxx';
```

### 基于角色授权方式（RoleARN）

需要创建一个角色和权限策略：权限策略代表OSS 服务的访问策略，将这个策略授权给创建的角色。

**以下主要讲述角色授权方式 (RoleARN) 的具体操作步骤**：

1. 阿里云侧操作：在阿里云 RAM 控制台中创建权限策略 (CzUdfOssAccess)：注意：需要用户具有 RAM 权限

* 访问阿里云访问控制（RAM）产品控制台
* 左侧导航栏 **权限管理** -> **权限策略**，在权限策略界面选择 **创建权限策略**
* 在**创建权限策略**页面选择 **脚本编辑** 页签，将下面`  [bucket_name_1|2|3]  `替换为实际的 OSS bucket 名称。注意：按照阿里云OSS 的约定，相同的 bucket 需要有两条 Resource 条目：`"acs:oss:*:*:bucket_name_1" `与 `"acs:oss:*:*:bucket_name_1/*"`同时存在才能达到授权效果：

```JSON
{
    "Version": "1",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "oss:GetObject",
                "oss:ListObjects",
                "oss:PutObject",
                "oss:DeleteObject"
            ],
            "Resource": [
                "acs:oss:*:*:bucket_name_1",
                "acs:oss:*:*:bucket_name_1/*",
                "acs:oss:*:*:bucket_name_2",
                "acs:oss:*:*:bucket_name_2/*",
                "acs:oss:*:*:bucket_name_3",
                "acs:oss:*:*:bucket_name_3/*"
            ]
        }
    ]
}
```

![](.topwrite/assets/OSS_P.jpeg)

^

2. 阿里云侧：在阿里云 RAM 中创建角色CzUDFRole：

* 在阿里云访问控制（RAM）控制台左侧导航栏 **身份管理** -> **角色**，点击 **创建角色**

* 在 **创建角色** 页面中，选择类型为 **阿里云账号**，在 **配置角色** 中填写自定义角色名称（如 CzUDFRole），在 **选择信任的云账号** 中选择 **其他云账号**，并填入账号 ID：1384322691904283，点击 **完成**。

* 创建完成之后，点击**为角色授权**: 在**自定义策略**中，将刚创建的策略（CzUdfOssAccess）授权给该角色。在角色 CzUDFRole 详情页中，获取该角色的 RoleARN 信息：`'acs:ram::1222808864xxxxxxx:role/czudfrole'`

![](.topwrite/assets/20231113-153016.jpeg)

3. Lakehouse 侧：创建 Connection

* 在 Studio 或者 Lakehouse JDBC 客户端中执行以下命令：

```SQL
CREATE STORAGE CONNECTION hz_oss_conn_rolearn 
    TYPE oss 
    REGION = 'cn-hangzhou' 
    ROLE_ARN = 'acs:ram::1222808864467016:role/czudfrole' 
    ENDPOINT = 'oss-cn-hangzhou-internal.aliyuncs.com';
```

* 执行 `desc connection` 获取 `external ID `信息：本实例中，external ID 为：`O0lQUogDJajHqnAQ`

> 为了防止 ROLE\_ARN 被第三方获取进行未授权的数据访问，可以使用` EXTENRAL ID` 作为一种额外的验证层，确保只有当请求中包含了预设的 `EXTERNAL ID` 时，这一访问才会被允许。这意味着即使第三方知道了其他一些访问信息（如角色ARN），没有正确的 `EXTERNAL ID` 也无法访问资源。

![](.topwrite/assets/bloygC9Z6Q.jpg)

4. 客户侧：在阿里云 RAM -> 角色->  信任策略中，修改 CzUDFRole 的**信任策略**：`"sts:ExternalId" `部分

^

```Python
{
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "O0lQUogDJajHqnAQ"
        }
      },
      "Effect": "Allow",
      "Principal": {
        "RAM": [
          "acs:ram::1384322691904283:root"
        ]
      }
    }
  ],
  "Version": "1"
}
```

##

## 创建腾讯云存储连接

本步骤的目标是：允许 Lakehouse 集群访问腾讯云上的对象存储 COS。为了完成这个目标，可以通过腾讯云**访问管理**提供的两种身份认证方式：**访问密钥** 和 **角色授权**。

### 基于AK密钥方式

```sql
CREATE STORAGE CONNECTION my_conn 
  TYPE COS
  ACCESS_KEY = '<access_key>'
  SECRET_KEY = '<secret_key>'
  REGION = 'ap-shanghai'
  APP_ID = '1310000503';
```

**参数**：

* **TYPE**：为对象存储类型，腾讯云应填写 `COS`（大小写不限）

* **ACCESS\_KEY / SECRET\_KEY**：为腾讯云的访问密钥，获取方式参考：[访问密钥](https://cloud.tencent.com/document/product/598/40488)

* **REGION**：指腾讯云对象存储 COS 的数据中心所在的地域。相同地域内云器 Lakehouse 访问腾讯云 COS 时，COS服务将自动路由至内网访问。具体取值请参考腾讯云文档：[地域和访问域名](https://cloud.tencent.com/document/product/436/6224)。

* **APP\_ID**：腾讯云存储桶的命名由存储桶名称（BucketName）和 APPID 两部分组成，两者以中划线“-”相连。例如 `examplebucket-1310000503`，其中 `examplebucket` 为用户自定义，`1310000503` 为系统生成数字串（APPID）。

### 基于角色授权

STEP1: 创建权限策略 (LakehouseAccess)：

* 登录腾讯云，进入**访问管理**产品控制台
* 在**访问管理**页面左侧导航栏进入**策略**，在权限控制界面选择 **新建自定义策略** -> **按策略生成器创建** -> **可视化策略生成器**。
* 在**可视化策略生成器**页签中：**服务**（**Service**）: 选择 **对象存储(cos**)；**操作（Action）**：选择 **全部操作**（可根据实际需要的操作，做更细粒度的选择）；**资源（Resource**）：根据需要选择**全部资源**或者**特定资源**。本示例中选择特定资源，为上海区的` cz-volume-sh-1311343935`![](.topwrite/assets/20240625-211734.jpeg)
* 点击**下一步**，填写**策略名称**为 LakehouseAccess 和描述后，点击**完成**

STEP2：客户侧创建角色（LakehouseRole）

* 进入腾讯云**访问管理**产品控制台
* 在**访问管理**页面左侧导航栏进入**角色** -> **新建角色** -> **腾讯云账户**， 选择**其他主账号**，在 **账号ID** 中输入 `100029595716`（云器的腾讯云主账号），其它选项保持默认，点击**下一步**
* 在**配置角色策略**配置中，将刚才新建的 LakehouseAccess 自定义策略授权给当前角色。点击 **下一步**，在**角色命名**中填写 `LakehouseRole `完成创建。
* 创建成功后，在角色列表中，进入角色 `LakehouseRole` 的详情页，获取该角色的 RoleARN 信息：  `qcs::cam::uin/1000*******:roleName/LakehouseRole`

STEP3：Lakehouse 侧创建 Connection

* 在 Studio 或者 Lakehouse JDBC 客户端中执行以下命令：

```
CREATE STORAGE CONNECTION my_tx_connection_arn
   TYPE cos
   REGION = 'ap-shanghai'
   ROLE_ARN = 'qcs::cam::uin/1000********:roleName/LakehouseRole'
   APP_ID = '131****35';
```

* 注意：为了防止 ROLE\_ARN 被第三方获取进行未授权的数据访问，可以使用` EXTENRAL ID` 作为一种额外的验证层，确保只有当请求中包含了预设的 `EXTERNAL ID` 时，这一访问才会被允许。这意味着即使第三方知道了其他一些访问信息（如角色ARN），没有正确的 `EXTERNAL ID` 也无法访问资源。
* 在创建存储连接的过程中，Lakehouse 会生成此EXTERNAL ID，可以将此EXTERNAL ID 配置到 COS 账号的角色校验中实现访问控制：

```
-- 查看 EXTERNAL ID 
DESC CONNECITON my_tx_connection_arn ;
```

![](.topwrite/assets/20240625-214538.jpeg)

* 客户侧：进入腾讯云**访问管理**控制台中，**角色** -> **LakehouseRole** -> **角色载体**-> **管理载体**，选择 **添加账户** -> 选择**当前主账号**，并填写主账号ID：`100029595716`（云器的腾讯云主账号），并勾选**开启校验**，输入刚才 DESC 结果中的 EXTERNAL\_ID，点击 **确定**-> **更新**

## 创建亚马逊云存储连接

本步骤的目标是：允许 Lakehouse 集群访问亚马逊云 (AWS) 的对象存储 S3。为了完成这个目标，可以通过 AWS 的 **身份与访问管理 (IAM)** 产品提供的两种身份认证方式：**访问密钥** 和 **角色授权**。

### 基于访问密钥

```
CREATE STORAGE CONNECTION aws_bj_conn
    TYPE S3
    ACCESS_KEY = 'AKIAQNBSBP6EIJE33***'
    SECRET_KEY = '7kfheDrmq***************************'
    ENDPOINT = 's3.cn-north-1.amazonaws.com.cn'
    REGION = 'cn-north-1';
```

**参数**：

* TYPE：为对象存储类型，AWS 应填写 S3（大小写不限）
* ACCESS\_KEY / SECRET\_KEY：为AWS 的访问密钥，获取方式参考：[访问密钥](https://docs.aws.amazon.com/zh_cn/IAM/latest/UserGuide/id_credentials_access-keys.html)
* ENDPOINT:  S3 的服务地址，AWS 中国区分为北京区和宁夏区，北京区的S3 的服务地址为 `s3.cn-north-1.amazonaws.com.cn`， 宁夏区 `s3.cn-northwest-1.amazonaws.com.cn`，可参考：[中国区终端节点](https://docs.amazonaws.cn/aws/latest/userguide/endpoints-arns.html) 分别找到北京区域和宁夏区域的终端节点 -> Amazon S3 对应的终端节点
* REGION：AWS 中国区分为北京区和宁夏区，区域值为：北京区 `cn-north-1`， 宁夏区 `cn-northwest-1`，可参考：[中国区终端节点](https://docs.amazonaws.cn/aws/latest/userguide/endpoints-arns.html)

### 基于角色授权

需要在目标云对象存储 S3 所属的账号，在 IAM 中创建一个**权限策略**和**角色**：权限策略代表访问AWS S3 数据的规则，将这个策略授权给创建的角色。云器 Lakehouse 通过扮演这个角色来实现与 S3 中数据的读写操作。

STEP1: AWS侧创建权限策略 (LakehouseAccess )：

* 登录AWS 云平台，进入**身份与访问管理(IAM**) 产品控制台
* 在 IAM 页面左侧导航栏进入 **账户设置**，在 **Security Token Service (STS)** 区域的 **终端节点** 列表中，找到当前实例对应云器Lakehouse 的区域，如果 **STS 状态** 为“未开启”，请将其开启。
* 在 IAM 页面左侧导航栏进入 **策略**，在 **策略** 界面选择 **创建策略**，在策略编辑器中选择 JSON 方式
* 将要添加允许云器Lakehouse 访问 S3 bucket 和目录的策略。下面是策略的样例，请用实际的bucket 和路径前缀名称替换 `<bucket>` 和 `<perfix>` 名称
* **注意**：请将 `"s3:prefix" `项中填写:  `["*"]` or `["<path>/*"]` 分别代表授予对指定 bucket 或 bucket 中路径中的所有前缀的访问权限。

```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
              "s3:PutObject",
              "s3:GetObject",
              "s3:GetObjectVersion",
              "s3:DeleteObject",
              "s3:DeleteObjectVersion"
            ],
            "Resource": "arn:aws:s3:::<bucket>/<prefix>/*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket",
                "s3:GetBucketLocation"
            ],
            "Resource": "arn:aws:s3:::<bucket>",
            "Condition": {
                "StringLike": {
                    "s3:prefix": [
                        "<prefix>/*"
                    ]
                }
            }
        }
    ]
}
```

* 点击 **下一步**，输入策略名称（如 LakehouseAccess）和描述（选填）
* 点击创建策略完成策略创建

STEP2: AWS侧创建角色 (LakehouseVolumeRole)：

* 登录AWS 云平台，进入**身份与访问管理(IAM**) 产品控制台
* 在 IAM 页面左侧导航栏进入**角色** -> **创建角色** -> **AWS账户**，选择 **另一个AWS账户**，在 Account ID 输入 `028022243208`

> 注意：为了防止 ROLE\_ARN 被第三方获取进行未授权的数据访问，可以勾选 **选项** 中的 **需要外部 ID（第三方担任此角色时的最佳实践）**，勾选之后 **EXTENRAL ID** 项可以填写 `000000` 占位符稍后填充。`EXTERNAL ID` 作为一种额外的验证层，确保只有当请求中包含了预设的 `EXTERNAL ID` 时，这一访问才会被允许。这意味着即使第三方知道了其他一些访问信息（如角色ARN），没有正确的 `EXTERNAL ID` 也无法访问资源。

![](.topwrite/assets/image_1728551322654.png)

* 选择下一步，在添加权限（Add permissions）页面，选择STEP1 中创建的策略 `LakehouseAccess `**后**，选择下一步
* 填写 Role name (例：`LakehouseVolumeRole` ) 和描述，点击 **创建角色** 完成角色创建
* 在角色详情页中，获取 **Role ARN** 的值，用来创建 STORAGE CONNECTION

![](.topwrite/assets/image_1728551348143.png)

STEP3: 云器 Lakehouse 侧创建 STORAGE CONNECTION ：

* 在 Studio 或者 Lakehouse JDBC 客户端中执行以下命令：

```
CREATE STORAGE CONNECTION aws_bj_conn_arn
  TYPE S3
  REGION = 'cn-north-1'
  ROLE_ARN = 'arn:aws-cn:iam::02802*******:role/LakehouseVolumeRole';
```

* 在创建存储连接的过程中，Lakehouse 会生成此EXTERNAL ID，可以将此EXTERNAL ID 配置到 STEP2创建的 AWS IAM 角色（`LakehouseVolumeRole`）的 Trust Policy 中，实现附加的访问控制：

```
-- 查看 EXTERNAL ID 
DESC CONNECITON aws_bj_conn_arn ;
```

![](.topwrite/assets/20240626-215920.jpeg)

* 在AWS IAM 的控制台，左侧导航栏中进入角色 **Roles**，找到 STEP2 中创建的角色并进入角色详情页面，在 **Trust relationships** 中将 `sts:ExternalId `的值`  000000  `替换为 DESC 结果中的` EXTERNAL_ID`。点击**更新** 完成角色策略更新。

## 创建Kafka存储连接

Kafka连接主要是用于Kafka外部表，可以方便地从 Kafka 中读取数据流，并将这些数据流作为表进行查询和分析。

### 语法

```SQL
CREATE STORAGE CONNECTION connection_name
    TYPE kafka
    BOOTSTRAP_SERVERS = ['server1:port1', 'server2:port2', ...]
    SECURITY_PROTOCOL = 'PLAINTEXT';
```

### 参数说明

* **connection\_name**: 连接的名称，用于后续引用。
* **TYPE**: 连接类型，此处为 `kafka`。
* **BOOTSTRAP\_SERVERS**: Kafka 集群的地址列表，格式为 `['host1:port1', 'host2:port2', ...]`。
* **SECURITY\_PROTOCOL**: 安全协议，可以是 `PLAINTEXT` 等。

### 示例

```SQL
CREATE STORAGE CONNECTION test_kafka_conn
    TYPE kafka
    BOOTSTRAP_SERVERS = ['47.99.48.62:9092']
    SECURITY_PROTOCOL = 'PLAINTEXT';
```

## 创建 HDFS 连接

HDFS 连接主要用于 Lakehouse 联邦查询，可以方便地读取 HDFS 中的数据。

### 语法

```SQL
CREATE STORAGE CONNECTION <connection_name> TYPE HDFSNAME_NODE='<nameservice_id>'NAME_NODE_RPC_ADDRESSES=['<rpc_address>']
```

### 参数说明

* `<connection_name>` ：自定义的连接名称，用于标识该 HDFS 连接，例如`hdfs_conn`。
* `TYPE HDFS` ：指定连接类型为 HDFS。
* `NAME_NODE` ：对应 [HDFS 配置](https://hadoop.apache.org/docs/stable/hadoop-project-dist/hadoop-hdfs/HDFSHighAvailabilityWithNFS.html)中的`dfs.nameservices`，是 HDFS 集群的逻辑名称，例如`zetta-cluster`。
* `NAME_NODE_RPC_ADDRESSES` ：对应 [HDFS 配置](https://hadoop.apache.org/docs/stable/hadoop-project-dist/hadoop-hdfs/HDFSHighAvailabilityWithNFS.html)中的`dfs.namenode.rpc-address`，是 NameNode 的 RPC 地址，格式为`[<host>:<port>]`，例如`['11.110.239.148:8020']`。

### 案例

```SQL
CREATE STORAGE CONNECTION hdfs_connTYPE HDFSNAME_NODE='zetta-cluster'NAME_NODE_RPC_ADDRESSES=['11.110.239.148:8020'];
```

^
