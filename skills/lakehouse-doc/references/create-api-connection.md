# 创建 API CONNECTION

API CONNECTION 主要用于存储和保护第三方应用服务的身份认证信息。借助 API CONNECTION，云器 Lakehouse 的 EXTERNAL FUNCTION（外部函数）能够以安全的方式通过 API 调用与这些服务进行交互。目前，API CONNECTION 支持的外部服务包括 **阿里云函数计算（Function Compute**）、**腾讯云云函数（Cloud Functions**），以及 **AWS Lambda**。

## 语法

```
CREATE API CONNECTION [ IF NOT EXISTS ] <connection_name>
  TYPE  CLOUD_FUNCTION
  PROVIDER = '<provider>'
  REGION = '<region>'
  ROLE_ARN = '<role_arn>'
  NAMESPACE = '<namespace>'
  CODE_BUCKET = '<code_bucket>'
```

### 参数说明

| 参数                | 说明                                                                                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection_name` | 要创建的 API 连接名称。                                                                                                                                                                                                                            |
| `PROVIDER`        | 云函数服务提供商。支持的取值包括：`'tencent'`、`'aliyun'` 和 `'aws'`。                                                                                                                                                                                        |
| `REGION`          | 云函数部署所在的区域。&#xA;**示例**：&#xA;• 阿里云：`'cn-shanghai'`（[区域代码参考](https://help.aliyun.com/document_detail/40654.html)）&#xA;• 腾讯云：`'ap-beijing'`（[区域代码参考](https://intl.cloud.tencent.com/document/product/213/6091)）&#xA;• AWS：`'cn-northwest-1'` |
| `ROLE_ARN`        | 用于执行云函数的角色 ARN&#xA;**示例（阿里云**）：&#xA;`acs:ram::1222800000000000:role/czudfrole`                                                                                                                                                            |
| `NAMESPACE`       | 云函数的命名空间。**腾讯云需要提供该值**。对于其他云服务，可填写 `'default'`，或根据实际情况留空。                                                                                                                                                                                 |
| `CODE_BUCKET`     | 存储云函数代码包的对象存储 bucket 名称。                                                                                                                                                                                                                  |

其中，NAMESPACE：在腾讯云使用必须提供。如果是其他云服务则可以不填写或者直接填写`'default'`该值如下图所示获取
![](.topwrite/assets/image_1735616872087.png)

^

## 案例说明

API CONNECTION 主要应用于 EXTERNAL FUNCTION 的创建。EXTERNAL FUNCTION 的使用如下过程

* 用户开通云上的函数计算服务（如阿里云的函数计算FC）和对象存储服务
* 将函数执行代码 & 可执行文件、依赖的库、模型和数据文件，打包上传至对象存储
* 并且授予云器 Lakehouse 操作上述服务和访问函数文件的权限
* 用户在云器 Lakehouse SQL 语句中调用 EXTERNAL FUNCTION
* 云器 Lakehouse 根据提供的服务地址和认证信息发送 http 请求调用运行函数
* 云器 Lakehouse 获取响应信息返回结果
  因此您必须开通函数计算服务和对象存储服务。并且授权给云器 Lakehouse 权限

### 阿里云创建API CONNECTION

* **环境准备**
  EXTERNAL FUNCTION 依赖阿里云的 "[对象存储](https://oss.console.aliyun.com/overview)" 和 "[函数计算](https://fcnext.console.aliyun.com/overview)" 服务, 请确保相关服务已开通

* 步骤1: 用户开通云上的函数计算服务（如阿里云的函数计算FC）和对象存储服务

* 步骤2.  阿里云侧操作：在阿里云 RAM 控制台中创建权限策略 (CzUdfOssAccess )：注意：需要用户具有RAM权限
  * 访问阿里云访问控制（RAM）[产品控制台](https://ram.console.aliyun.com/policies)
  * 左侧导航栏 **权限管理** -> **权限策略**，在权限控制界面选择 搜索**AliyunFCFullAccess**->编辑 **AliyunFCFullAccess** 权限策略 添加下面"acs\*\*:**Service**": "**fc.aliyuncs.com**"\*\*部分
    ```JSON
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

* 步骤3:在阿里云 RAM 控制台中创建权限策略 (CzUdfOssAccess )：注意：需要用户具有RAM权限

  * 访问阿里云访问控制（RAM）产品控制台
  * 左侧导航栏 **权限管理** -> **权限策略**，在权限控制界面选择 **创建权限策略**
  * 在**创建权限策略**页面选择 **脚本编辑** 的页签，将下面`  [bucket_name_1|2|3]  `替换为实际的 OSS bucket 名称。注意：按照阿里云OSS 的约定，相同的bucket 需要有两条Resource条目：`"acs:oss:*:*:bucket_name_1" `与 `"acs:oss:*:*:bucket_name_1/*"`同时存在才能达到授权效果：

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

* 步骤4： 阿里云控制台：在阿里云 RAM 中创建角色（如：CzUDFRole）：
  * 在RAM 控制台左侧导航栏 **身份管理** -> **角色**，点击**创建角色**
  * 在 **创建角色** 页面中，选择类型为 **阿里云账号**， 配置角色中填写自定义**角色名称 如** (CzUDFRole)，在**选择信任的云账号** 中选择 **其他云账号**，并写入：1384322691904283（云器 Lakehouse 上海的云主账号），点击**完成**
  * 创建完成之后，点击**为角色授权**:
  * 在**系统策略**中，将 **AliyunFCFullAccess** 策略授权给该角色 CzUDFRole
  * 在**自定义策略**中，将刚创建的策略（**CzUdfOssAccess**）授权给该角色

* 步骤5： 创建完成之后，点击**为角色授权**: 在**自定义策略**中，将刚创建的策略（CzUdfOssAccess）授权给该角色。在角色 CzUDFRole 详情页中，获取该角色的 RoleARN 信息：`'acs:ram::1222808864xxxxxxx:role/czudfrole'`![](.topwrite/assets/20231113-153016.jpeg)

* 步骤6：将上面的role\_arn填入到语法参数重，创建阿里云函数计算连接

```SQL
CREATE API CONNECTION my_funciton_connection
TYPE CLOUD_FUNCTION
PROVIDER='aliyun'
REGION='cn-hangzhou'
ROLE_ARN='acs:ram::1757168149572678:role/czudfrole'
CODE_BUCKET='function-compute-my1';
```

* 步骤7: desc connection 获取 external ID 信息：本实例中，external ID 为：`VW9UaGwYENBQ7cFp`
  ```
  DESC CONNECTION my_funciton_connection;
  ```
  ![](.topwrite/assets/image_1735638011131.png)
  * 在阿里云 RAM -> 角色->  信任策略中，修改 CzUDFRole 的**信任策略** `"sts:ExternalId"` 部分：
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

### 腾讯云创建 API CONNECTION

**环境准备**
EXTERNAL FUNCTION 依赖腾讯云的 "[对象存储](https://console.cloud.tencent.com/cos)" 和 "[云函数](https://console.cloud.tencent.com/scf/list?rid=1\&ns=default)" 服务, 请确保相关服务已开通.

* 对象存储：需要在云器 Lakehouse 部署地域 (例如 ap-shanghai) 用于存放函数基础代码;
* 云函数：**云函数** 服务开通后, 建议使用模板创建功能手动创建一个函数, 推荐使用Flask 框架模板等带有WebFunc标签的模板; 在此过程中, 腾讯云控制台 会引导用户完成一些初始化配置, 例如开通日志服务 (CLS) 等依赖服务, 创建必要 访问控制 (CAM) 角色, 授予必要 访问控制 (CAM) 权限等.
* 步骤1: 用户开通腾讯云的云函数计算服务。云函数 region 保持和云器 Lakehouse开服区域一致
  ![](.topwrite/assets/image_1735616566747.png)
* 步骤2: 数据创建权限策略 (LakehouseAccess )：

  * 登录腾讯云，进入**访问管理**[产品控制台](https://console.cloud.tencent.com/cam/policy)
  * 在**访问管理**页面左侧导航栏进入**策略**，在权限控制界面选择 **新建自定义策略** -> **按策略生成器创建** -> **可视化策略生成器**。
  * 在**可视化策略生成器**页签中**服务**（**Service**）: 选择**云函数**；**操作（Action**）：选择**全部操作**（可根据实际需要的操作，做更细粒度的选择）；**资源（Resource**）：根据需要选择**全部资源**或者**特定资源**。本次案例选择为特定资源,使用 namespace 授权如下图，点击编辑按钮，选择**步骤1**中的开通region,资源可以是\*也可以指定namespace，本次案例为中的命名空间：default。如图二中云函数红色标记的位置![](.topwrite/assets/image_1735629287184.png)
    ![](.topwrite/assets/image_1735616872087.png)
    点击创建完成该策略
* 步骤3:[创建角色](https://console.cloud.tencent.com/cam/role) CzUdfRole
  * 新建角色
  * 选择 腾讯云账户
  * 选择 **其他主账户 100029595716 (云器主账号**),其它选项保持默认，点击**下一步**
  * 在**配置角色策略**配置中，将刚才新建的 LakehouseAccess 自定义策略授权给当前角色。点**击下一步**，在**角色命名**中填写 `LakehouseRole `完成创建。
  * 创建成功后，在角色列表中，进入角色 `LakehouseRole` 的详情页，获取该角色的 RoleARN 信息：  `qcs::cam::uin/1000*******:roleName/LakehouseRole`
  * 记住角色 RoleArn, 例如: `qcs::cam::uin/1000*******:roleName/LakehouseRole`
* 步骤4:开通 COS 新建 BUCKET
  * 新建 bucket 用于存放函数代码 region 保持和云器 Lakehouse 开服区域一致。如下图新建的 bucket 为myfunction![](.topwrite/assets/image_1735629660423.png)
  * 授权给云器 Lakehouse 访问 bucket（myfunction）权限
  * 进入**访问管理**[产品控制台](https://console.cloud.tencent.com/cam/policy)。找到刚刚新建的“LakehouseAccess”策略。选择编辑![](.topwrite/assets/image_1735627370589.png)
  * 选择可视化策略生成器。添加权限![](.topwrite/assets/image_1735629943727.png)
  * **服务**（**Service**）: 选择 **对象存储(cos**)；**操作（Action**）：选择**全部操作**（可根据实际需要的操作，做更细粒度的选择）；**资源（Resource**）：根据需要选择**全部资源**或者**特定资源**。本示例中选择特定资源，为上海的`myfunction-131xxxxx`。![](.topwrite/assets/image_1735630105369.png)
  ^

```

-- 在 Studio 或者云器 Lakehouse JDBC 客户端中执行以下命令：

CREATE API CONNECTION my_funciton_connection
    TYPE CLOUD_FUNCTION
    PROVIDER='tencent'
    REGION='ap-shanghai'
    ROLE_ARN='qcs::cam::uin/xxxx:roleName/CzUDFRole'
    NAMESPACE='default'
    CODE_BUCKET='myfunction-131xxxx';
    
```

> 注意：为了防止 ROLE\_ARN 被第三方获取进行未授权的数据访问，可以使用` EXTENRAL ID` 作为一种额外的验证层，确保只有当请求中包含了预设的 `EXTERNAL ID` 时，这一访问才会被允许。这意味着即使第三方知道了其他一些访问信息（如角色ARN），没有正确的 `EXTERNAL ID` 也无法访问资源。
>
> 在 API CONNECTION 的过程中，云器 Lakehouse 会生成此EXTERNAL ID，可以将此EXTERNAL ID 配置到 COS 账号的角色校验中实现访问控制：
>
> ^
>
> \-- 查看 EXTERNAL ID&#x20;
>
> ```
> DESC CONNECTION my_funciton_connection ;
> ```

![](.topwrite/assets/image_1735630257317.png)

* 客户侧：进入腾讯云**访问管理**控制台中，**角色** -> **CzUDFRole** -> **角色载体**-> **管理载体**，选择 **添加账户** -> 选择**当前主账号**，并填写主账号ID：`100029595716`（云器的腾讯云主账号），并勾选**开启校验**，输入刚才 DESC 结果中的 EXTERNAL\_ID，点击 **确定**-> **更新**

### AWS 创建 API CONNECTION

* **环境准备**
  EXTERNAL FUNCTION 依赖阿里云的 "[对象存储](https://cn-north-1.console.amazonaws.cn/s3/get-started?region=cn-north-1\&bucketType=general)" 和 "[Lambda函数](https://cn-north-1.console.amazonaws.cn/lambda/home)" 服务, 请确保相关服务已开通.

* 步骤1: 用户开通云上的Lambda和对象存储服务

* 步骤2: AWS侧创建权限策略 (LakehouseAccess )：
  * 登录AWS 云平台，进入**身份与访问管理(IAM**) 产品控制台

  * 在 IAM 页面左侧导航栏进入 **账户设置**，在 **Security Token Service (STS**) 中的 **终端节点** 列表中，找到当前实例对应云器 Lakehouse 的区域，如果 **STS  状态** 的状态为未开启请开启。

  * 在 IAM 页面左侧导航栏进入 **策略**，在 **策略** 界面选择 **创建策略**，在策略编辑器中选择Json。

  * 将要添加允许云器 Lakehouse 访问 S3 bucket 和目录的策略。下面是策略的样例，请用实际的bucket 和路径前缀名称替换 `<bucket>`&#x20;
    ```JSON
    {
    	"Version": "2012-10-17",
    	"Statement": [
    		{
    			"Sid": "VisualEditor0",
    			"Effect": "Allow",
    			"Action": [
    				"lambda:CreateFunction",
    				"lambda:DeleteProvisionedConcurrencyConfig",
    				"lambda:GetFunctionConfiguration",
    				"lambda:ListProvisionedConcurrencyConfigs",
    				"lambda:GetProvisionedConcurrencyConfig",
    				"lambda:ListLayers",
    				"lambda:ListLayerVersions",
    				"lambda:DeleteFunction",
    				"lambda:GetAlias",
    				"lambda:ListCodeSigningConfigs",
    				"lambda:UpdateFunctionEventInvokeConfig",
    				"lambda:DeleteFunctionCodeSigningConfig",
    				"lambda:ListFunctions",
    				"lambda:GetEventSourceMapping",
    				"lambda:InvokeFunction",
    				"lambda:ListAliases",
    				"lambda:GetFunctionCodeSigningConfig",
    				"lambda:UpdateAlias",
    				"lambda:UpdateFunctionCode",
    				"lambda:ListFunctionEventInvokeConfigs",
    				"lambda:ListFunctionsByCodeSigningConfig",
    				"lambda:GetFunctionConcurrency",
    				"lambda:PutProvisionedConcurrencyConfig",
    				"lambda:ListEventSourceMappings",
    				"lambda:PublishVersion",
    				"lambda:DeleteEventSourceMapping",
    				"lambda:CreateAlias",
    				"lambda:ListVersionsByFunction",
    				"lambda:GetLayerVersion",
    				"lambda:PublishLayerVersion",
    				"lambda:InvokeAsync",
    				"lambda:GetAccountSettings",
    				"lambda:CreateEventSourceMapping",
    				"lambda:GetLayerVersionPolicy",
    				"lambda:PutFunctionConcurrency",
    				"lambda:DeleteCodeSigningConfig",
    				"lambda:ListTags",
    				"lambda:DeleteLayerVersion",
    				"lambda:PutFunctionEventInvokeConfig",
    				"lambda:DeleteFunctionEventInvokeConfig",
    				"lambda:CreateCodeSigningConfig",
    				"lambda:PutFunctionCodeSigningConfig",
    				"lambda:UpdateEventSourceMapping",
    				"lambda:UpdateFunctionCodeSigningConfig",
    				"lambda:GetFunction",
    				"lambda:UpdateFunctionConfiguration",
    				"lambda:UpdateCodeSigningConfig",
    				"lambda:GetFunctionEventInvokeConfig",
    				"lambda:DeleteAlias",
    				"lambda:DeleteFunctionConcurrency",
    				"lambda:GetCodeSigningConfig",
    				"lambda:GetPolicy"
    			],
    			"Resource": "*"
    		},
    		{
    			"Sid": "VisualEditor1",
    			"Effect": "Allow",
    			"Action": [
    				"s3:PutObject",
    				"s3:GetObject",
    				"s3:DeleteObjectVersion",
    				"s3:ListBucket",
    				"s3:DeleteObject",
    				"s3:GetBucketLocation",
    				"s3:GetObjectVersion"
    			],
    			"Resource": "arn:aws-cn:s3:::cz-udf-code"
    		}
    	]
    }
    ```

  * 选择  下一步，输入策略名称如,(LakehouseAccess）和描述（选填）

  * 点击创建策略完成策略创建

* 步骤3: AWS侧创建角色 (LakehouseVolumeRole)：

* 登录AWS 云平台，进入**身份与访问管理(IAM**) 产品控制台

* 在 IAM 页面左侧导航栏进入**角色** -> **创建角色** -> **AWS账户**，选择 **另一个AWS账户**，在 Account ID 输入 `028022243208`

> 注意：为了防止 ROLE\_ARN 被第三方获取进行未授权的数据访问，可以勾选 **选项** 中的 **需要外部ID(第三方担任此角色时的最佳实践**)，勾选之后 **EXTENRAL ID** 项可以填写 `000000` 占位符稍后填充。`EXTERNAL ID` 作为一种额外的验证层，确保只有当请求中包含了预设的 `EXTERNAL ID` 时，这一访问才会被允许。这意味着即使第三方知道了其他一些访问信息（如角色ARN），没有正确的 `EXTERNAL ID` 也无法访问资源。

![](.topwrite/assets/image_1728551322654.png)

* 选择下一步，在添加权限（Add permissions）页面，选择步骤2 中创建的策略 `LakehouseAccess `**后**，选择下一步
* 填写 Role name (例：`LakehouseVolumeRole` ) 和描述，点击 **创建角色** 完成角色创建
* 在角色详情页中，获取 **Role ARN** 的值，用来创建 STORAGE CONNECTION

![](.topwrite/assets/image_1728551348143.png)

^

步骤4: 云器 Lakehouse 侧创建 API CONNECTION ：

* 在 Studio 或者云器 Lakehouse JDBC 客户端中执行以下命令：

```
CREATE API CONNECTION udf_noah 
    TYPE cloud_function
    PROVIDER = 'aws'
    REGION = 'cn-north-1'
    ROLE_ARN = 'arn:aws-cn:iam::028022243208:role/CzUdfRole'
    CODE_BUCKET = 'cz-udf-code'
    NAMESPACE = 'default';
```

* 在创建存储连接的过程中，云器 Lakehouse 会生成此EXTERNAL ID，可以将此EXTERNAL ID 配置到步骤3 创建的 AWS IAM 角色（`LakehouseVolumeRole`）的 Trust Policy 中，实现附加的访问控制：

```
-- 查看 EXTERNAL ID 
DESC CONNECTION udf_noah ;
```

![](.topwrite/assets/image_1735802829076.png)

* 在AWS IAM 的控制台，左侧导航栏中进入角色 **Roles**，找到步骤3 中创建的角色并进入角色详情页面，在 **Trust relationships** 中将 `sts:ExternalId `的值`  000000  `替换为 DESC 结果中的` EXTERNAL_ID`。点击**更新** 完成角色策略更新。

### 后续：

在完成 API CONNECTION 的创建之后，就可以继续创建外部函数，支持用 Python、Java 脚本处理云器 Lakehouse 中的数据。请参考: [创建外部函数](CREATE_EXTERNATL_FUNCTION.md)
