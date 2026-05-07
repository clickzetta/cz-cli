### 函数名称
COLLATION\_SORT\_KEY

#### 功能描述
COLLATION\_SORT\_KEY 函数根据指定的字符集，为输入的字符串生成一个排序键，用于按照特定字符集的规则对字符串进行排序。

#### 语法
```
collection_sort_key(str, coll)
```
* str: 输入的字符串。
* coll: 指定的排序规则。

#### 返回值
返回一个二进制值，表示输入字符串按照指定字符集生成的排序键。

#### 使用示例
1. 按照拼音顺序对中文字符串进行排序：
```
SELECT s, collation_sort_key(s, 'zh') AS sort_key
FROM ('你好', '苹果', '香蕉', '梨子', '草莓', '西瓜', '世界') AS t(s)
ORDER BY sort_key;
```
结果如下：
```
s   | sort_key
----|----------
你好 | 7A96647001060106
苹果 | 7DA963B401060106
梨子 | 71FDA16101060106
草莓 | 5496779301060106
西瓜 | 8EAD628E01060106
世界 | 86056B8E01060106
香蕉 | 90A36AB101060106
```

2. 按照英文字母顺序（如`utf8mb4_general_ci`）对英文字符串进行排序：
```
SELECT s, collation_sort_key(s, 'en') AS sort_key
FROM ('apple', 'banana', 'cherry', 'grape', 'orange', 'strawberry') AS t(s)
ORDER BY sort_key;
```
结果如下：
```
s    | sort_key
-----|----------
apple | 0100000001000000
banana | 0100000002000000
cherry | 0100000003000000
grape | 0100000004000000
orange | 0100000005000000
strawberry | 0100000010000000
```

#### 注意事项
* COLLATION\_SORT\_KEY 函数仅适用于字符串类型的输入。
* 指定的排序规则必须有效，否则将返回 NULL。
* 生成的排序键是二进制值，可用于 ORDER BY 子句进行排序。