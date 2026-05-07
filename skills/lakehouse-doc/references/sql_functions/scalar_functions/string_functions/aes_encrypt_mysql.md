### AES\_ENCRYPT\_MYSQL 函数

```
aes_encrypt_mysql(expr, key [, mode [, iv]])
```

#### 功能描述

AES\_ENCRYPT\_MYSQL 函数用于对二进制数据进行 AES 加密。该函数兼容 MySQL 的 AES 加密函数，可以方便地在 SQL 语句中实现数据加密。

#### 参数说明

* **expr** (binary)：需要加密的二进制数据。
* **key** (binary)：用于加密的密钥，密钥长度必须为 16、24 或 32 字节。
* **mode** (string, 可选)：AES 加密模式，格式为 "aes-bits-mode"，默认为 "aes-128-ecb"。可选的模式有 "aes-128-ecb"、"aes-192-ecb"、"aes-256-ecb"、"aes-128-cbc"、"aes-192-cbc"、"aes-256-cbc"。
* **iv** (binary, 可选)：AES 加密算法中的初始向量（IV），长度应与块大小（block size）相同，默认为空。

#### 返回结果

返回加密后的二进制数据。

#### 使用示例

1.  使用 AES-128-ECB 模式对字符串 "1234" 进行加密：

    ```sql
SELECT base64(aes_encrypt_mysql('1234', 'namePURPMEF4uI2mQSbrWOhpAvu6OGbE4U', 'aes-128-ecb'));
+--------------------------+
|           res            |
+--------------------------+
| fOltPBoMXnbhu54SSxaaAQ== |
+--------------------------+
```

2.  使用 AES-256-CBC 模式对字符串 "Hello, world!" 进行加密：

    ```sql
SELECT base64(aes_encrypt_mysql('Hello, world!', 'mySecretKey12345678', 'aes-256-cbc', '1234567890123456'));
+--------------------------+
|           res            |
+--------------------------+
| AiVMpzHAOQdAEGgVjP60ig== |
+--------------------------+
```

#### 注意事项

*   密钥长度必须为 16、24 或 32 字节，否则加密过程将失败。
*   初始向量（IV）仅在 CBC 模式下有效，ECB 模式下 IV 参数将被忽略。
*   为保证安全性，请使用足够强度的密钥和随机生成的初始向量（IV）。
*   加密结果为二进制数据，使用 base64 函数可以将其转换为可打印的字符串形式。

^
