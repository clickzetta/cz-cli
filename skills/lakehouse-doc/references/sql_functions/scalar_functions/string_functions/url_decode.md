### URL_DECODE
```sql
url_decode(str)
```

#### 功能
对 URL 编码的字符串进行解码。

#### 参数
* `str`: string 类型，URL 编码的字符串

#### 返回结果
* **string 类型**：返回解码后的字符串。
* 将 `%XX` 形式的编码转换为对应的字符。
* 将 `+` 转换为空格。

#### 举例
```sql
> SELECT url_decode('http%3A%2F%2Fyunqi.tech%2Fpath%3Fquery%3D%26key%3D2');
http://yunqi.tech/path?query=&key=2

> SELECT url_decode('http%3A%2F%2Fyunqi.tech%2Fpath%3Fquery%3D%26key%3D+2');
http://yunqi.tech/path?query=&key= 2

> SELECT url_decode('http%3A%2F%2Fyunqi.tech%2Fpath%3Fquery%3D1%23ref');
http://yunqi.tech/path?query=1#ref
```

#### 说明
* 这是 `URL_ENCODE` 函数的逆操作。
* `+` 会被解码为空格。
* 支持标准的 URL 百分号编码解码。
