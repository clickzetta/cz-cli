### RTRIM 函数

#### 概述

RTRIM 函数用于去除字符串 `str` 右侧的指定字符或空格。如果不提供 `trimStr` 参数，则默认删除字符串右侧的所有空格。

#### 语法

```
rtrim(str, [trimStr])
```

#### 参数

* `str` (string): 需要处理的原始字符串。
* `trimStr` (string, 可选): 指定要从字符串右侧删除的字符集。

#### 返回值

返回处理后的字符串。

#### 使用示例

1. 删除字符串右侧的所有空格：
   ```sql
   > SELECT rtrim('   Hello World   ');
   'Hello World'
   ```

2. 删除字符串右侧的特定字符：
   ```sql
   > SELECT rtrim('Hello-World-', '-');
   'Hello-World'
   ```

^
^
