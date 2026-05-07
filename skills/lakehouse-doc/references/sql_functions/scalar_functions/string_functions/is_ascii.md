### IS_ASCII
``` sql
is_ascii(str)
```

#### 功能
判断str是否只包含ascii编码的字符

#### 参数
* str: string

#### 返回结果
boolean

#### 举例
```sql
> SELECT a, is_ascii(a)
  FROM VALUES (""),
  ("abcd"),
  ("中文"),
  ("，。") AS t(a);
        true
abcd    true
中文    false
，。    false

```