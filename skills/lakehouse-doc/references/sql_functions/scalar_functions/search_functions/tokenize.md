## TOKENIZE

```SQL
TOKENIZE(input, option)
```

### 功能说明

分词函数。如果想检查分词的实际效果，或者对一段文本进行分词，可以使用 `tokenize` 函数。

### 参数说明

* input：要分词的语句

* option：此参数是必填项，用于指定分词设置，`map('analyzer', 'english')`。

  * 目前支持的分词类型如下：
    * keyword：不分词，不做大小写转换，直接将完整的文本保存到倒排索引中。匹配时必须完全匹配。
    * english：只识别连续的ASCII字母或数字，并转换为小写。只有英文字符时性能最优。
    * chinese：识别中文和英文字符，过滤标点符号，英文部分转换为小写。
    * unicode：识别所有Unicode字符，支持西欧字母转小写和中日韩文字的分词，过滤标点符号，并转换为小写。

### 返回结果

返回值为 array\<string>

### 案例

```SQL
--使用keworkd分词
SELECT TOKENIZE('Lakehouse的倒排索引',map('analyzer', 'keyword')) as toke;
+--------------------+
|        toke        |
+--------------------+
| ["Lakehouse的倒排索引"] |
+--------------------+
SELECT TOKENIZE('Lakehouse的倒排索引',map('analyzer', 'chinese')) as toke;
+--------------------------------+
|              toke              |
+--------------------------------+
| ["lakehouse","的","倒排","索引"] |
+--------------------------------+
--使用unicode分词
SELECT TOKENIZE('Lakehouse的倒排索引',map('analyzer', 'unicode')) as toke;
+--------------------------------+
|              toke              |
+--------------------------------+
| ["lakehouse","的","倒","排","索引"] |
+--------------------------------+
--使用english分词
SELECT TOKENIZE('Lakehouse inverted index',map('analyzer', 'english')) as toke;
+----------------------------------+
|               toke               |
+----------------------------------+
| ["lakehouse","inverted","index"] |
+----------------------------------+
```
