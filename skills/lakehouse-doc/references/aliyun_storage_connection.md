# 创建阿里云存储连接

本步骤的目标是：允许 Lakehouse 集群访问阿里云上的对象存储 OSS。为了完成这个目标，可以使用阿里云提供的两种身份认证方式：**访问密钥** 和 **角色授权**。

## 方式1：访问密钥（AK信息）

仅需提供拥有访问 OSS 权限的账号的 AccessKey ID 和 AccessKey Secret 信息，利用这些信息创建存储连接（Storage Connection）对象，示例如下：

```
CREATE STORAGE CONNECTION IF NOT EXISTS hz_conn_ak
    TYPE oss
    ENDPOINT = 'oss-cn-hangzhou.aliyuncs.com'
    ACCESS_ID = 'LTAI5tMmbq1Ty1xxxxxxxxx'
    ACCESS_KEY = '0d7Ap1VBuFTzNg7gxxxxxxxxxxxx'
    COMMENTS = 'OSS public endpoint';
```

## 方式2：角色授权（RoleARN）

需要创建一个角色和权限策略：权限策略代表 OSS 服务的访问策略，将这个策略授权给创建的角色。

**以下主要讲述角色授权方式（RoleARN）的具体操作步骤：**

### 1. 阿里云侧操作：在阿里云 RAM 控制台中创建权限策略（CzUdfOssAccess）

> 注意：需要用户具备 RAM 权限。

* 访问阿里云访问控制（RAM）控制台。
* 左侧导航栏 **权限管理** -> **权限策略**，在权限策略界面选择 **创建权限策略**。
* 在**创建权限策略**页面选择 **脚本编辑** 页签，将下面 `[bucket_name_1|2|3]` 替换为实际的 OSS bucket 名称。注意：按照阿里云 OSS 的约定，同一个 bucket 需要有两条 Resource 条目：`"acs:oss:*:*:bucket_name_1"` 与 `"acs:oss:*:*:bucket_name_1/*"` 同时存在才能达到授权效果。

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

### 2. 阿里云侧：在阿里云 RAM 中创建角色 CzUDFRole

* 在阿里云访问控制（RAM）控制台左侧导航栏，进入 **身份管理** -> **角色**，创建角色。
* 在 **创建角色** 页面中，选择类型为 **阿里云账号**，在 **配置角色** 中填写自定义角色名称（如 CzUDFRole），在 **选择信任的云账号** 中选择 **其他云账号**，并填入账号 ID：1384322691904283，点击 **完成**。

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

* 创建完成后，点击 **为角色授权**：在 **自定义策略** 中，将刚创建的策略（CzUdfOssAccess）授权给该角色。在角色 CzUDFRole 详情页中，获取该角色的 RoleARN 信息：`'acs:ram::1222808864xxxxxxx:role/czudfrole'`

![](.topwrite/assets/20231113-153016.jpeg)

^

### 3. Lakehouse 侧：创建 Connection

* 在 Studio 或者 Lakehouse JDBC 客户端中执行以下命令：

```SQL
CREATE STORAGE CONNECTION hz_oss_conn_rolearn 
    TYPE oss 
    REGION = 'cn-hangzhou' 
    ROLE_ARN = 'acs:ram::1222808864467016:role/czudfrole' 
    ENDPOINT = 'oss-cn-hangzhou-internal.aliyuncs.com';
```

* 执行 `DESC CONNECTION` 获取 `external_id` 信息。本示例中，`external_id` 为 `O0lQUogDJajHqnAQ`。

![](.topwrite/assets/bloygC9Z6Q.jpg)

### 4. 阿里云侧：在阿里云 RAM -> 角色 -> 信任策略中，修改 CzUDFRole 的 **信任策略**

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

创建完成后，即可在创建外部 Volume 的语句中，使用该 Storage Connection 对象挂载对象存储的路径。
