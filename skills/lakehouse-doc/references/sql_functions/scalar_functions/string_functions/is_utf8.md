### IS_UTF8
``` sql
is_utf8(str)
```

#### 功能
判断str是否只包含utf-8编码的字符

#### 参数
* str: string

#### 返回结果
boolean

#### 举例
```sql
> SELECT a, is_utf8(a)
  FROM VALUES (""),
  ("abcd"),
  ("中文"),
  ("，。") AS t(a);
        true
abcd    true
中文    true
，。    true

```