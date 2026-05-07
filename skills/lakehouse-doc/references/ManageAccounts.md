# 账户管理指南

本指南将详细介绍如何管理您的云器 Lakehouse 账户，包括登录管理中心、管理账户信息和用户等操作。

## 1. 基本概念

### 账户名称

在云器 Lakehouse 中，每个账户都有一个唯一的标识，用于在全球范围内区分不同的账户。账户名称由一个8位的随机字符串组成，在您完成注册后，系统会自动生成。账户名称也决定了您的登录地址和部分访问配置。

账户名称是您在云器 Lakehouse 内的唯一识别名称，一经生成后不可变更。您可以通过注册完成后的提示或管理中心的首页找到您的账户名称。

:-: ![](.topwrite/assets/image_1739329828430.png =780)

^

:-: ![](.topwrite/assets/image_1739329908616.png =783)

### 登录地址

在云器产品中，每个账户拥有其独立的登录地址。登录地址的为<你的账户名称>.accounts.clickzetta.com。

:-: ![](.topwrite/assets/image_1739329970639.png =799)

### 服务实例名称

云器 Lakehouse 是一个多云的大数据平台，支持在多个云厂商的不同 region 下创建服务实例。每个服务实例的开通都相当于在该region内生成一个唯一标识并在基础设施资源中划分出一片逻辑区域，用于为您提供Lakehouse的相关服务。服务实例名称（instance_name）即为服务实例的唯一标识，在您开通服务实例时自动生成，由一段8位的随机字符串组成。您可在服务实例的URL，或服务实例首页右侧找到您的服务实例名称。

:-: ![](.topwrite/assets/image_1740540520113.png =807)

### 账户注册手机

账户注册手机是您在创建账户并添加第一个用户时填写的手机号码。初始账户手机号与您在账户下的第一个用户的手机号码相同。账户管理员可以在管理中心中更改注册手机号。请妥善保管您的注册手机号，因为在云器产品中，每个注册手机号只能对应一个账户，这是找回账户的唯一凭证。

:-: ![](.topwrite/assets/image_1739330026163.png =806)

^
^

## 2. 账户名称与标识

### 为什么需要账户名称

* **全局唯一性**：账户名称可帮助您在云器 Lakehouse 的全局服务网络中，唯一区分您的账户。
* **安全控制**：在启用账户安全策略和第三方应用集成时，账户名称是必需的信息，用于访问或交互。

### 账户名称的常用场景

Lakehouse的账户名称主要用于以下场景：

**1. 登录Lakehouse Web 界面**

当您要登录 Lakehouse 的管理中心或Web界面时，需要在浏览器中输入正确的账户 URL（<您的账户名称>.accounts.clickzetta.com）。

^

### 为什么需要服务实例名称

* **全局唯一性**：实例名称可帮助您在云器 Lakehouse 的全局服务网络中，唯一区分您的服务实例。服务名称包含了region信息，可以直接与region内Lakehouse服务进行交互，简化了交互时的访问链路。
* **安全控制**：在启用网络安全策略和使用第三方客户端访问Lakehouse时，服务名称是必需的信息，用于访问或交互。
* **资源链接**：在进行数据共享等功能时，需要明确指定目标或源账户的服务实例名称。

### 服务实例名称的常用场景

**1. Lakehouse CLI / 其他客户端 / 驱动**

当使用 CLI、JDBC 驱动、Python/R/Java 等客户端或第三方工具（如 BI 工具）连接 Lakehouse 时，需要在连接配置中指定服务实例名称。

**2. 第三方应用与服务集成**

当外部应用（如数据分析平台、ETL 工具、云存储服务）与 Lakehouse 交互时，需提供服务实例名称来确定目标 Lakehouse 服务。

**3. 数据共享操作**

在 Lakehouse 的“数据共享”功能中，需要使用服务实例名称来定义操作范围。

^

## Lakehouse账户URL与登录

### 登录地址格式

在云器 Lakehouse 中，每个账户拥有其独立的登录地址（URL）。一般格式如下：

[https://<您的账户名称>.accounts.clickzetta.com](https://<您的账户名称>.accounts.clickzetta.com)

示例：

如果您的账户名称为41nprq1k，则登录地址为：

41nprq1k.accounts.clickzetta.com

### 使用账户名称登录

您可以直接在浏览器中输入 `https://<您的账户名称>.accounts.clickzetta.com`，进入登录页面。在登录页面中，您需要输入或选择正确的账户名称，以及用户名和密码。您的账户下可能存在一个或多个用户，您可以在上述页面中登录任一用户。您也可以通过输入用户的手机号码找回用户名或重置用户密码。当多个用户共用一个手机号码时，您可以通过该手机号码找回所有关联的用户名，以便选择所需登录的用户。

### 登录流程与找回方式

1\. 访问 `https://<账户标识>.accounts.clickzetta.com` 或统一入口 `https://accounts.clickzetta.com`。

2\. 在登录页面，输入或选择正确的账户名称，并输入您的 **用户名**、**密码**。

3\. 如果忘记用户名或密码，可以在完成账户名称输入后，通过用户的手机号找回。

当多个用户共用一个手机号码时，可通过该号码找回关联的所有用户名，并选择所需的用户登录。

4\. 如果忘记账户名称，可以在登录页面通过账户的注册手机号找回，一个手机号仅对应一个注册账户。

^

## 在SQL / 配置文件 / 第三方工具中使用账户标识

为了在各种环境下准确指定目标 Lakehouse 账户，您需要根据具体场景选择合适的账户标识格式：

### 在SQL语句中使用

当您在 Lakehouse SQL 中需要引用其他账户（例如进行数据共享）时，使用：服务实例名称（instance_name）。

例如：

`--为数据共享指定分享实例`

`ALTER SHARE share_demo ADD INSTANCE <instance_name>;`

### 在配置文件或第三方工具中使用

* **SQL客户端、驱动或库配置**

在某些SQL客户端（如DBeaver）JDBC驱动或Python/Java库的配置文件中，需要配置链接参数，例如配置DBeaver驱动时：

:-: ![](.topwrite/assets/image_1740549280083.png =361)

JDBC 连接字符串内，需要使用服务实例名称（instance_name），如：

`jdbc:clickzetta://<your_instance_name>.ap-southeast-1-alicloud.api.clickzetta.com/demo_workspace?username=demo_user&password=DemoPassword&schema=public&virtualCluster=DEFAULT`

再例如配置Python SDK时，需要使用服务实例名称（instance\_name）：

`from clickzetta import connect`

`# 建立连接`

`conn = connect(username='username',`

`               password='password',`

`               service='<region\_id>.api.clickzetta.com',`

`               instance='your_instance_name',`

`               workspace='quickstart_ws',`

`               schema='public',`

`               vcluster='default')`

^
^

## 维护账户信息

### 查看账户注册手机

当您使用具备账户管理员角色的用户登录云器后，可以在管理中心对您的账户进行管理。在“账户主页”页面，您可以查看账户的基本信息以及账户的登录URL。您还可以点击注册手机号右侧的“修改”按钮，更改账户注册的手机号码。
请注意，您可在“账户中心”页面分别看到“账户信息”中的注册手机——这意味着该账户绑定的手机号码，可通过该手机号找回账户名称；以及“用户信息”中的“注册手机”——这意味着当前登录用户的手机号码，仅与当前登录用户身份绑定，可用于当前用户登录时的 MFA 验证、找回用户名、找回密码等操作。请注意区分。

![](.topwrite/assets/image_1740550879753.png)

### 修改账户注册手机

如果需要修改账户注册手机，需要具备账户管理员（account_admin）身份的用户登录。在进入“账户中心”后，点击“账户信息”栏“注册手机”旁的修改按钮，在验证完旧手机号码后，可以录入并修改为新的手机号。

:-: ![](.topwrite/assets/image_1740551806201.png =765)

:-: ![](.topwrite/assets/image_1740551835302.png =438)

### 修改账户名称或服务实例名称

账户名称（account\_name）和服务实例名称（instance\_name）均为全局唯一名称，生成后不允许进行修改。

^
^

如需进一步管理账户下的用户，请参考[管理用户](account_user_management.md)。
