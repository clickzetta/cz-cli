## MATCH\_PHRASE\_PREFIX

```SQL
MATCH_PHRASE_PREFIX(inverted_column,query, option) 
```

### 功能说明

只有构建倒排索引的列才能使用该函数，匹配短语前缀，inverted\_column的分词结果，前n-1一个匹配规则和match\_phrase相同。首先会将query根据分词构建查询。比如inverted\_column中有一个字段的数据是“a b cd”，输入的query是"b c"，query被分析器分词之后，产生两个小写的字母：b和c，然后根据分析的结果构造一个布尔查询，默认情况下，引擎内部执行的查询逻辑是：b首先匹配到inverted\_column中的b,然后c可以匹配cd的前缀，则返回该行数据

### 参数说明

* **inverted\_column**: 用于构建倒排索引的列。
* **query**: 您想要搜索的文本字符串。
* **option**: 此参数是必填项，用于指定分词设置。它必须与构建倒排索引的列所使用的分词方法相同。支持`auto`参数，该参数会自动与`inverted_column`中的分词设置进行匹配，例如：`map('analyzer', 'auto')`。

### 返回结果

boolean类型

### 案例

```SQL
select match_phrase_prefix('a b cd', 'b c', map('analyzer', 'english'))as res;
+------+
| res  |
+------+
| true |
+------+
select match_phrase_prefix('a b dc', 'b c', map('analyzer', 'english'))as res;
+-------+
|  res  |
+-------+
| false |
+-------+
```
