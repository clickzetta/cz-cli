## MATCH\_PHRASE

```SQL
MATCH_PHRASE(inverted_column,query, option) 
```

### 功能说明

只有构建倒排索引的列才能使用该函数，在match\_all的基础上，匹配的结果顺序要和query分词结果的顺序要一致且连续，忽略大小写。然后会将query根据分词构建查询，最终返回查询结果。比如查询字符串是“Microsoft Azure Party”，被分析器分词之后，产生三个小写的单词：microsoft，azure和party，然后根据分析的结果构造一个布尔查询，默认情况下，引擎内部执行的查询逻辑是：只要eventname字段值中包含所有microsoft、azure或party，并且顺序microsoft、azure或party，是那么返回该行数据

### 参数说明

* **inverted\_column**: 用于构建倒排索引的列。
* **query**: 您想要搜索的文本字符串。
* **option**: 此参数是必填项，用于指定分词设置。它必须与用于构建倒排索引的列使用相同的分词方法。支持`auto`参数，该参数会自动与`inverted_column`中的分词设置进行匹配，例如：`map('analyzer', 'auto')`。

### 返回结果

boolean类型

### 案例

1. 案例一

```SQL
select match_phrase('a b c', 'a b', map('analyzer', 'english')) as res;
+------+
| res  |
+------+
| true |
+------+
select match_phrase('a b c', 'a c', map('analyzer', 'english')) as res;
+-------+
|  res  |
+-------+
| false |
+-------+
```

2. 查询包含Elfriede Heaney的数据，要求必须含有Elfriede和Heaney，但不要求先后顺序。

```SQL
--查询包含Elfriede Heaney的数据
select * from bulkload_data where match_all(data,'Elfriede Heaney',map('analyzer', 'auto'));
+------------------------------------------------------------------------------------------------------------------------------------------+
|                                                                   data                                                                   |
+------------------------------------------------------------------------------------------------------------------------------------------+
| {"address":"Apt. 423 78018 Wisozk Meadow, West Marge, WV 16958","name":"Elfriede Heaney","email":"jamar.schoen@gmail.com"}               |
| {"address":"Suite 654 89305 Dan Drive, Haiview, AZ 55461","name":"Elfriede Heaney","email":"kristofer.upton@yahoo.com"}                  |
| {"address":"1133 Cartwright Orchard, Port Jonathon, UT 71589-4026","name":"Elfriede Heaney","email":"douglass.nitzsche@yahoo.com"}       |
| {"address":"115 Avery Mountains, New Elfriede, TN 83686-3466","name":"Clarence Heaney","email":"emmanuel.lockman@yahoo.com"}             |
| {"address":"Suite 342 631 Konopelski Hollow, East Chingview, UT 79212","name":"Elfriede Heaney DDS","email":"mikel.keebler@hotmail.com"} |
| {"address":"415 Elfriede Row, New Adriene, SC 90250","name":"Jefferson Heaney","email":"len.price@yahoo.com"}                            |
+------------------------------------------------------------------------------------------------------------------------------------------+

select * from bulkload_data where match_phrase(data,'Elfriede Heaney',map('analyzer', 'unicode'));
+------------------------------------------------------------------------------------------------------------------------------------------+
|                                                                   data                                                                   |
+------------------------------------------------------------------------------------------------------------------------------------------+
| {"address":"Apt. 423 78018 Wisozk Meadow, West Marge, WV 16958","name":"Elfriede Heaney","email":"jamar.schoen@gmail.com"}               |
| {"address":"Suite 654 89305 Dan Drive, Haiview, AZ 55461","name":"Elfriede Heaney","email":"kristofer.upton@yahoo.com"}                  |
| {"address":"1133 Cartwright Orchard, Port Jonathon, UT 71589-4026","name":"Elfriede Heaney","email":"douglass.nitzsche@yahoo.com"}       |
| {"address":"Suite 342 631 Konopelski Hollow, East Chingview, UT 79212","name":"Elfriede Heaney DDS","email":"mikel.keebler@hotmail.com"} |
+------------------------------------------------------------------------------------------------------------------------------------------+
```
