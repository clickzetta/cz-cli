# 创建腾讯云存储连接

本步骤的目标是：允许 Lakehouse 集群访问腾讯上的对象存储 COS。为了完成这个目标，可以通过腾讯云**访问管理**提供的两种身份认证方式：**访问密钥** 和 **角色授权**。

## 基于访问密钥

```sql
CREATE STORAGE CONNECTION my_conn 
  TYPE COS
  ACCESS_KEY = '<access_key>'
  SECRET_KEY = '<secret_key>'
  REGION = 'ap-shanghai'
  APP_ID = '1310000503';
```

### 参数：

* **TYPE**：为对象存储类型，腾讯云应填写 `COS`（大小写不限）

* **ACCESS\_KEY / SECRET\_KEY**：为腾讯云的访问密钥，获取方式参考：[访问密钥](https://cloud.tencent.com/document/product/598/40488)

* **REGION**：指腾讯云对象存储 COS 的数据中心所在的地域。相同地域内云器Lakehouse访问腾讯云COS时，COS服务将自动路由至内网访问。具体取值请参考腾讯云文档：[地域和访问域名](https://cloud.tencent.com/document/product/436/6224)。

* **APP\_ID**：腾讯云存储桶的命名由存储桶名称（BucketName）和 APPID 两部分组成，两者以中划线“-”相连。例如 `examplebucket-1310000503`，其中 `examplebucket` 为用户自定义，`1310000503` 为系统生成数字串（APPID）。

## 基于角色授权

### STEP1: 数据创建权限策略 (LakehouseAccess )：

* 登录腾讯云，进入**访问管理**产品控制台
* 在**访问管理**页面左侧导航栏进入**策略**，在权限控制界面选择 **新建自定义策略** -> **按策略生成器创建** -> **可视化策略生成器**。
* 在**可视化策略生成器**页签中：**服务**（**Service**）: 选择 **对象存储(cos**)；**操作（Action**）：选择**全部操作**（可根据实际需要的操作，做更细粒度的选择）；**资源（Resource**）：根据需要选择**全部资源**或者**特定资源**。本示例中选择特定资源，为上海区的` cz-volume-sh-1311343935`![](.topwrite/assets/20240625-211734.jpeg)
* 点击**下一步**，填写**策略名称**为 LakehouseAccess 和描述后，点击**完成**

### STEP2：客户侧创建角色（LakehouseRole）

* 进入腾讯云**访问管理**产品控制台
* 在**访问管理**页面左侧导航栏进入**角色** -> **新建角色** -> **腾讯云账户**， 选择**其他主账号**，在 **账号ID** 中输入 `100029595716`（云器的腾讯云主账号），其它选项保持默认，点击**下一步**
* 在**配置角色策略**配置中，将刚才新建的 LakehouseAccess 自定义策略授权给当前角色。点**击下一步**，在**角色命名**中填写 `LakehouseRole `完成创建。
* 创建成功后，在角色列表中，进入角色 `LakehouseRole` 的详情页，获取该角色的 RoleARN 信息：  `qcs::cam::uin/1000*******:roleName/LakehouseRole`

### STEP3：Lakehouse 侧创建 Connection

* 在 Studio 或者 Lakehouse JDBC 客户端中执行以下命令：

```
CREATE STORAGE CONNECTION my_tx_connection_arn
   TYPE cos
   REGION = 'ap-shanghai'
   ROLE_ARN = 'qcs::cam::uin/1000********:roleName/LakehouseRole'
   APP_ID = '131****35';
```

^

> 注意：为了防止 ROLE\_ARN 被第三方获取进行未授权的数据访问，可以使用` EXTENRAL ID` 作为一种额外的验证层，确保只有当请求中包含了预设的 `EXTERNAL ID` 时，这一访问才会被允许。这意味着即使第三方知道了其他一些访问信息（如角色ARN），没有正确的 `EXTERNAL ID` 也无法访问资源。

* 在创建存储连接的过程中，Lakehouse 会生成此EXTERNAL ID，可以将此EXTERNAL ID 配置到 COS 账号的角色校验中实现访问控制：

```
-- 查看 EXTERNAL ID 
DESC CONNECITON my_tx_connection_arn ;
```

![](.topwrite/assets/20240625-214538.jpeg)

^

* 客户侧：进入腾讯云**访问管理**控制台中，**角色** -> **LakehouseRole** -> **角色载体**-> **管理载体**，选择 **添加账户** -> 选择**当前主账号**，并填写主账号ID：`100029595716`（云器的腾讯云主账号），并勾选**开启校验**，输入刚才 DESC 结果中的 EXTERNAL\_ID，点击 **确定**-> **更新**

***

^
