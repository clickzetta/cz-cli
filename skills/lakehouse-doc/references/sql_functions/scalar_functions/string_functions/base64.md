### BASE64 函数
#### 简介
BASE64 函数用于将二进制数据转换为 BASE64 编码格式的字符串。该函数对于在需要文本格式的场合中处理二进制数据非常有用，例如在电子邮件中发送图片或在 Web 页面中嵌入音频文件。

#### 语法
```sql
base64(bin)
```
#### 参数
- bin (binary): 要转换的二进制数据。

#### 返回结果
- 返回一个字符串，表示输入二进制数据的 BASE64 编码。

#### 使用示例
1. 转换字符串为 BASE64 编码：
```sql
> SELECT base64('Hello, world!');
SGVsbG8sIHdvcmxkIQ==
```
2. 结合其他函数使用，例如将当前时间转换为日期时间格式并转换为 BASE64 编码：
```sql
> SELECT base64(now()::string);
MjAyNC0wNC0wOCAxNTo1NjoyMy4yNDM0OQ==
```
#### 注意事项
- 输入的二进制数据必须是一个合法的二进制字符串，否则可能导致转换失败。