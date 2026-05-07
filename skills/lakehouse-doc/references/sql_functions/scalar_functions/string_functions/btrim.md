### BTRIM 函数
```
btrim(str [, trimStr])
```
#### 功能描述
BTRIM 函数用于去除字符串 `str` 左右两侧的指定字符或空格。如果未提供 trimStr 参数，则默认去除字符串两端的所有空格字符。

#### 参数说明
* `str` (string): 需要进行处理的原始字符串。
* `trimStr` (string, 可选): 指定需要从字符串两端去除的字符集。

#### 返回结果
返回处理后的字符串。

#### 使用示例
```sql
-- 去除字符串两端的所有空格
SELECT 'X' || btrim('    HelloWorld    ') || 'X'; -- 结果为 'XHelloWorldX'

-- 去除字符串左侧的特定字符
SELECT btrim('abcHelloWorld', 'abc'); -- 结果为 'HelloWorld'

-- 去除字符串右侧的特定字符
SELECT btrim('HelloWorldabc', 'abc'); -- 结果为 'HelloWorld'

-- 同时去除字符串两端的特定字符
SELECT btrim('abcHelloWorldabc', 'abc'); -- 结果为 'HelloWorld'

-- 去除字符串两端的数字
SELECT btrim('123HelloWorld123', '0123456789'); -- 结果为 'HelloWorld'

-- 去除字符串两端的多种字符
SELECT btrim('!@#HelloWorld!@#', '!@#'); -- 结果为 'HelloWorld'
```
#### 注意事项
* 如果 `trimStr` 参数为空字符串，则不会对原始字符串进行任何修改。
* 当 `trimStr` 参数包含的字符在原始字符串中不存在时，函数仍然会正常工作，返回原始字符串。
* 如果需要去除字符串中间的字符，请考虑使用其他字符串处理函数。