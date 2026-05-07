### RIGHT
```sql
right(str, len)
```

#### 功能
返回字符串 str 右边的 len 个字符。

#### 参数
* `str`: string 类型
* `len`: int 类型，要返回的字符数量

#### 返回结果
* string 类型，返回字符串右边的 len 个字符。
* 如果 `len` 小于等于 0，返回空字符串
* 如果 `len` 大于字符串长度，返回完整字符串

#### 举例
```sql
> SELECT right('hello-world', 7);
o-world

> SELECT right('hello-world', 0);


> SELECT right('hello-world', 99);
hello-world

> SELECT right('hell你好world', 7);
你好world
```

#### 说明
* 支持 Unicode 字符，按字符（而非字节）计数
