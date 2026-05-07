### AES_DECRYPT 函数
```
aes_decrypt(expr, key [, mode [, padding]])
```
#### 功能描述
AES_DECRYPT 函数用于对二进制数据进行 AES（高级加密标准）解密操作。该函数支持多种模式和填充方式，以满足不同的安全需求。

#### 参数说明
* **expr** (binary): 待解密的二进制密文。
* **key** (binary): 用于解密的密钥，密钥长度必须为 16、24 或 32 字节。
* **mode** (string, 可选): 加密模式，可选项包括 'ECB' 和 'GCM'。默认值为 'ECB'。
* **padding** (string, 可选): 填充方式，可选项包括 'NONE'、'PKCS' 和 'DEFAULT'。'NONE' 表示不进行填充，'PKCS' 表示使用 Public Key Cryptography Standards 算法进行填充，'DEFAULT' 表示在 'GCM' 模式下不填充，在 'ECB' 模式下使用 'PKCS' 填充。默认值为 'DEFAULT'。

#### 返回结果
返回解密后的二进制数据。

#### 使用示例
1. 使用 ECB 模式和 PKCS 填充方式解密数据：
```sql
SELECT CAST(aes_decrypt(unbase64('xrsSNC1NEmSaAUjrTV7VlA=='), '0000111122223333', 'ECB') AS string);
```
结果：
```
Hello World
```

2. 使用 GCM 模式和无填充方式解密数据：
```sql
SELECT CAST(aes_decrypt(unbase64('t6rWxtWMvIP9zNTFpVUEcpphuGdBTnUx+jOKrbNfHThVlB1DMzlt'), '0000111122223333', 'GCM' ) AS string);
```
结果：
```
Hello World
```


#### 注意事项
* 请确保提供正确的密钥和填充方式，否则解密结果可能不正确。
* 在使用 GCM 模式时，请注意填充方式的选择，因为不同的填充方式可能会影响解密结果。
* 为了确保数据安全，建议使用复杂的密钥和合适的加密模式。