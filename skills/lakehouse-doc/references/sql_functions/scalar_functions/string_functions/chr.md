### CHR
```sql
chr(n)
```

#### 功能
返回给定整数对应的 ASCII 字符。

#### 参数
* `n`: int 类型，表示字符的 ASCII 码，范围 0-127。

#### 返回结果
* string 类型，返回对应的字符。
* 如果输入为 NULL，返回 NULL。

#### 举例
```sql
> SELECT chr(100);
d

> SELECT chr(65);
A

> SELECT chr(null);
NULL
```