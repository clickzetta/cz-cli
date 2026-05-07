# 创建亚马逊云存储连接

本步骤的目标是：允许 Lakehouse 集群访问亚马逊云(AWS)的对象存储 S3。为了完成这个目标，可以通过AWS 的**身份与访问管理(IAM**) 产品提供的两种身份认证方式：**访问密钥** 和 **角色授权**。

## 基于访问密钥

```
CREATE STORAGE CONNECTION aws_bj_conn
    TYPE S3
    ACCESS_KEY_ID = 'AKIAQNBSBP6EIJE33***'
    SECRET_ACCESS_KEY = '7kfheDrmq***************************'
    ENDPOINT = 's3.cn-north-1.amazonaws.com.cn'
    REGION = 'cn-north-1';
```

### 参数：

* TYPE：为对象存储类型，AWS 应填写 S3（大小写不限）
* ACCESS\_KEY\_ID / SECRET\_ACCESS\_KEY：为AWS 的访问密钥，获取方式参考：[访问密钥](https://docs.aws.amazon.com/zh_cn/IAM/latest/UserGuide/id_credentials_access-keys.html)
* ENDPOINT:  S3 的服务地址，AWS 中国区分为北京区和宁夏区，北京区的S3 的服务地址为 `s3.cn-north-1.amazonaws.com.cn`， 宁夏区 `s3.cn-northwest-1.amazonaws.com.cn`，可参考：[中国区终端节点](https://docs.amazonaws.cn/aws/latest/userguide/endpoints-arns.html) 分别找到北京区域和宁夏区域的终端节点 -> Amazon S3 对应的终端节点
* REGION：AWS 中国区分为北京区和宁夏区，区域值为：北京区 `cn-north-1`， 宁夏区 `cn-northwest-1`，可参考：[中国区终端节点](https://docs.amazonaws.cn/aws/latest/userguide/endpoints-arns.html)。国际站请参考：[Amazon Simple Storage Service endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/s3.html)

## 基于角色授权

需要在目标云对象存储 S3 所属的账号，在 IAM 中创建一个**权限策略**和**角色**：权限策略代表访问AWS S3 数据的规则，将这个策略授权给创建的角色。云器 Lakehouse 通过扮演这个角色来实现与 S3 中数据的读写操作。

### STEP1: AWS侧创建权限策略 (LakehouseAccess )：

* 登录AWS 云平台，进入**身份与访问管理(IAM**) 产品控制台
* 在 IAM 页面左侧导航栏进入 **账户设置**，在 **Security Token Service (STS**) 中的 **终端节点** 列表中，找到当前实例对应云器Lakehouse 的区域，如果 **STS  状态** 的状态为未开启请开启。
* 在 IAM 页面左侧导航栏进入 **策略**，在 **策略** 界面选择 **创建策略**，在策略编辑器中选择 JSON 方式
* 将要添加允许云器Lakehouse 访问 S3 bucket 和目录的策略。下面是策略的样例，请用实际的bucket 和路径前缀名称替换 `<bucket>` 和 `<perfix>` 名称

> 注意：请将 `"s3:prefix" `项中填写:  `["*"]` or `["<path>/*"]` 分别代表授予对指定 bucket 或 bucket 中路径中的所有前缀的访问权限。

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

* 选择  下一步，输入策略名称如,(LakehouseAccess）和描述（选填）
* 点击创建策略完成策略创建

### STEP2: AWS侧创建角色 (LakehouseVolumeRole)：

* 登录AWS 云平台，进入**身份与访问管理(IAM**) 产品控制台
* 在 IAM 页面左侧导航栏进入**角色** -> **创建角色** -> **AWS账户**，选择 **另一个AWS账户**，在 Account ID 输入 `028022243208（中国站） / 014617434350（国际站）`

> 注意：为了防止 ROLE\_ARN 被第三方获取进行未授权的数据访问，可以勾选 **选项** 中的 **需要外部ID(第三方担任此角色时的最佳实践**)，勾选之后 **EXTENRAL ID** 项可以填写 `000000` 占位符稍后填充。`EXTERNAL ID` 作为一种额外的验证层，确保只有当请求中包含了预设的 `EXTERNAL ID` 时，这一访问才会被允许。这意味着即使第三方知道了其他一些访问信息（如角色ARN），没有正确的 `EXTERNAL ID` 也无法访问资源。

![](.topwrite/assets/image_1728551322654.png)

* 选择下一步，在添加权限（Add permissions）页面，选择STEP1 中创建的策略 `LakehouseAccess `**后**，选择下一步
* 填写 Role name (例：`LakehouseVolumeRole` ) 和描述，点击 **创建角色** 完成角色创建
* 在角色详情页中，获取 **Role ARN** 的值，用来创建 STORAGE CONNECTION

![](.topwrite/assets/image_1728551348143.png)

^

### STEP2: 云器 Lakehouse 侧创建 STORAGE CONNECTION ：

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
DESC CONNECITON my_tx_connection_arn ;
```

![](.topwrite/assets/20240626-215920.jpeg)

^

* 在AWS IAM 的控制台，左侧导航栏中进入角色 **Roles**，找到 STEP2 中创建的角色并进入角色详情页面，在 **Trust relationships** 中将 `sts:ExternalId `的值`  000000  `替换为 DESC 结果中的` EXTERNAL_ID`。点击**更新** 完成角色策略更新。

^
