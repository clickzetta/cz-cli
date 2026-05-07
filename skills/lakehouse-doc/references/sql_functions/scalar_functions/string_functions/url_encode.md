### URL_ENCODE
```sql
url_encode(str)
```

#### 功能
对字符串进行 URL 编码。

#### 参数
* str: string 类型，要编码的字符串

#### 返回结果
* string 类型，返回 URL 编码后的字符串
* 特殊字符会被转换为 `%XX` 的形式。
* 空格会被编码为 `+`。

#### 举例
```sql
> SELECT url_encode('http://yunqi.tech/path?query=&key=2');
http%3A%2F%2Fyunqi.tech%2Fpath%3Fquery%3D%26key%3D2

> SELECT url_encode('http://yunqi.tech/path?query=&key= 2');
http%3A%2F%2Fyunqi.tech%2Fpath%3Fquery%3D%26key%3D+2

> SELECT url_encode('http://yunqi.tech/path?query=1#ref');
http%3A%2F%2Fyunqi.tech%2Fpath%3Fquery%3D1%23ref
```

#### 说明
* 这是 `URL_DECODE` 函数的逆操作。
* 空格会被编码为 `+`。
* 支持标准的 URL 百分号编码。
* 常用于构造 URL 查询参数。
