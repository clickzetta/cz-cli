### AES_ENCRYPT 函数
```sql
aes_encrypt(expr, key [, mode])
```
#### 功能描述
`aes_encrypt` 函数用于对二进制字符串进行 AES（高级加密标准）加密。该函数支持多种加密模式，包括 ECB 和 GCM。

#### 参数说明
- `expr` (binary)：待加密的二进制字符串。
- `key` (binary)：加密所用的密钥，密钥长度必须为 16、24 或 32 字节。
- `mode` (string)：加密模式，可选值包括 'ECB' 和 'GCM'。默认值为 'ECB'。

#### 返回值
返回加密后的二进制字符串。

#### 使用示例
```sql
-- 使用 ECB 模式加密
SELECT base64(aes_encrypt('Hello World', '0000111122223333', 'ECB'));
-- 结果：xrsSNC1NEmSaAUjrTV7VlA==

-- 使用 GCM 模式加密（注意：由于随机初始向量的存在，每次运行结果可能不同）
SELECT base64(aes_encrypt('Hello World', '0000111122223333', 'GCM'));
-- 结果示例：56vW7s/LqMLZ7dSdkshLNDSM6uo40nd3hUM1N5CpGAj1IL0xhebZ

-- 对加密结果进行 Base64 编码
SELECT base64(aes_encrypt('MoonshotAI', '1234567890123456', 'GCM'));
-- 结果示例：sIGnurS00ovS4c+Ic8btSanlSvvWUBIixkakCSonEA6vE7aakfY=

```
#### 注意事项
- 密钥长度必须为 16、24 或 32 字节，否则会导致加密失败。
- 在 GCM 模式下，每次加密都会生成随机的初始化向量，因此加密结果可能不同。
- 使用 Base64 编码可以方便地在不同环境中传输和存储二进制加密数据。