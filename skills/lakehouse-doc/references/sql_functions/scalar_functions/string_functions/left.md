### LEFT
```sql
left(str, len)
```

#### 功能
返回字符串 `str` 左边的 `len` 个字符。

#### 参数
* str: string 类型
* len: int 类型，要返回的字符数量

#### 返回结果
* string 类型，返回字符串左边的 `len` 个字符。
* 如果 `len` 小于或等于 0，返回空字符串。
* 如果 `len` 大于字符串长度，返回完整字符串。

#### 示例
```sql
> SELECT left('hello-world', 7);
hello-w

> SELECT left('hello-world', 0);


> SELECT left('hello-world', 99);
hello-world

> SELECT left('hello你好world', 7);
hello你好
```

#### 说明
* 支持 Unicode 字符，按字符（而非字节）计数。
* `len` 参数为负数时返回空字符串。
