### 掩码函数
```sql
mask_inner(str, margin1, margin2 [, mask_char]) 
mask_outer(str, margin1, margin2 [, mask_char]) 
```
#### 功能描述
`mask_inner` 和 `mask_outer` 函数用于对字符串中的部分字符进行替换，通常用于隐藏敏感信息，如密码、手机号码等。`mask_inner` 函数会保留字符串两端各 `margin1` 和 `margin2` 长度的字符，而将中间部分字符替换为指定的掩码字符（默认为 'X'）。`mask_outer` 函数则屏蔽字符串两端各 `margin1` 和 `margin2` 长度的字符，保留中间部分。

#### 参数说明
* `str`: 需要处理的原始字符串。
* `margin1`: 保留或屏蔽左端的字符数量。
* `margin2`: 保留或屏蔽右端的字符数量。
* `mask_char` (可选): 用于替换中间部分字符的掩码字符，默认为 'X'。

#### 返回值
返回处理后的字符串。

#### 使用示例
```sql
-- 示例1：隐藏手机号码中间四位
SELECT mask_inner('13812345678', 3, 4);
-- 返回结果：135XXXXX876

-- 示例2：保留邮箱地址的前后部分，隐藏用户名部分
SELECT mask Outer('alice@example.com', 5, 0);
-- 返回结果：XXXXX@example.com

-- 示例3：隐藏信用卡号中间八位
SELECT mask_inner('1234 5678 9012 3456', 4, 4, '*');
-- 返回结果：1234 **** 9012 3456

-- 示例4：隐藏身份证号码中间十位
SELECT mask_inner('11010519850605003X', 2, 10);
-- 返回结果：11XXXXXXXXX03X
```

通过以上示例，您可以根据实际需求灵活使用 `mask_inner` 和 `mask_outer` 函数来保护用户的隐私信息。