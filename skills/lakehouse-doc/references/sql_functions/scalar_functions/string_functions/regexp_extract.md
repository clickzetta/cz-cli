### REGEXP_EXTRACT 函数
```sql
regexp_extract(str, regexp [, idx])
```
#### 功能描述
REGEXP_EXTRACT 函数利用指定的正则表达式（regexp）从输入字符串（str）中提取匹配的文本。该函数使用 [re2](https://github.com/google/re2) 正则表达式引擎进行匹配。

#### 参数说明
* str (string)：待匹配的输入字符串。
* regexp (string)：用于匹配的正则表达式字符串。
* idx (int, 可选)：要抽取的分组（group）索引。索引从 1 开始，默认值为 1，表示提取第一个分组。若指定值为 0，则表示匹配整个正则表达式。

#### 返回值
返回一个字符串（string），包含匹配的文本。

#### 使用示例
```sql
-- 示例 1：提取字符串中的数字
> SELECT regexp_extract('价格为：100-500元', r'(\d+)-(\d+)', 1);
'100'

-- 示例 2：提取特定字符前的文本
> SELECT regexp_extract('abc123def', r'^(.*)\d', 1);
'abc12'

-- 示例 3：提取括号内的文本
> SELECT regexp_extract('（这里是示例）', r'（(.*)）', 1);
'这里是示例'

-- 示例 4：使用 idx 参数提取第二个分组
> SELECT regexp_extract('纽约-美国', r'(.*)-(.*)', 2);
'美国'

-- 示例 5：匹配整个正则表达式
> SELECT regexp_extract('需要匹配的文本', r'^(.*)$', 0);
'需要匹配的文本'
```
