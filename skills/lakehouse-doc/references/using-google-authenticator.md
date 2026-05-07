# 如何绑定 Google Authenticator 进行多因子身份验证 (MFA)

【区域限制】使用 Google Authenticator 进行多因子身份验证（MFA）仅在阿里云-新加坡以及 AWS-新加坡两个区域有效。

^

为了保护您的账户安全，我们支持使用 Google Authenticator 进行多因子身份验证 (MFA)。下面是详细的绑定步骤，帮助您在账户中启用 Google Authenticator。

## 1. 下载并安装 Google Authenticator

首先，请确保您在手机上安装了 Google Authenticator 应用。您可以从以下位置下载：

* **iOS 用户**：访问 [App Store](https://apps.apple.com/us/app/google-authenticator/id388497605)
* **Android 用户**：访问 [Google Play Store](https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2)

## 2. 登录到您的账户

在您的电脑或移动设备上打开浏览器，并登录到您的账户。

## 3. 添加云器账号动态密码

登录成功后，点击“添加动态密码”或右下角的“+”符号，添加账号。

可以选择“扫描二维码”方式，扫描云器 Lakehouse 上生成的二维码，完成账户添加；

也可以选择“输入设置密钥”方式，手动输入密钥，并选择“密钥类型”为“基于时间”，点击“添加”后即可完成动态密码的添加。

## 4. 完成验证

成功添加账户后，您将在 Google Authenticator 应用首页上看到刚添加的账户，以及对应的 6 位验证码。请在有效期内将验证码输入绑定窗口下方的验证码输入框中，点击“提交验证”。验证通过后，即完成绑定操作。

## 5. 重置绑定

您可以在登录验证弹窗或登录后的“账户信息”页面内，重置您绑定的 Google Authenticator。重置绑定时，需要验证您当前用户的手机号，验证成功后，重复上述第3、第4步即可完成重新绑定。

## 常见问题

### 1. 如果我换了手机怎么办？

您需要在新手机上重新下载 Google Authenticator 并登录您的 Google 账户。Google Authenticator 会保留您已绑定的账户。

### 2. 验证码失效怎么办？

请检查您的手机时间是否准确。如果问题仍然存在，尝试重新同步 Google Authenticator 应用的时间设置。

### 3. 我无法访问我的账户，该怎么办？

如果您无法通过 Google Authenticator 验证身份，请尝试重置您绑定的 Google Authenticator 账户。如果重置后仍无法正常验证，请您联系客户支持以寻求帮助。
