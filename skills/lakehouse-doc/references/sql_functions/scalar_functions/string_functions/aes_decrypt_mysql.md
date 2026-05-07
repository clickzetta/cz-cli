### AES_DECRYPT_MYSQL 函数
```
aes_decrypt_mysql(expr binary, key binary, mode string, [iv binary])
```
#### 功能描述
AES_DECRYPT_MYSQL 函数用于对二进制数据进行 AES 解密操作。该函数兼容 MySQL 的 AES 加密算法，可以确保与 MySQL 数据库中加密的数据无缝对接。

#### 参数说明
* `expr` (binary): 需要解密的二进制密文数据。
* `key` (binary): 用于解密的密钥，密钥长度必须为 16、24 或 32 字节。
* `mode` (string): AES 加密模式，格式为 "aes-bits-mode"，默认为 "aes-128-ecb"。可选模式包括："aes-128-ecb"、"aes-192-ecb"、"aes-256-ecb"、"aes-128-cbc"、"aes-192-cbc"、"aes-256-cbc"。
* `iv` (binary, 可选): AES 加密算法中的初始向量（Initial Vector），长度应与加密块大小相同。默认为空。

#### 返回结果
返回解密后的二进制数据。

#### 使用示例
使用 AES-128-ECB 模式解密数据：
```sql
SELECT CAST(AES_DECRYPT_MYSQL(UNBASE64('fOltPBoMXnbhu54SSxaaAQ=='), 'namePURPMEF4uI2mQSbrWOhpAvu6OGbE4U') AS STRING);
```
结果：
```
1234
```

#### 注意事项
* 请确保提供的密钥和模式与加密时使用的相同，否则解密将失败。
* 在使用 CBC 模式时，需要提供正确的初始向量（IV），否则解密结果可能不正确。
* 出于安全性考虑，建议使用 256 位 AES 加密并结合合适的加密模式，如 AES-256-CBC。