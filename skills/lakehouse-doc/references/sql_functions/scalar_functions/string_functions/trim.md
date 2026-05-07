### TRIM 函数

```
trim(str [, trimStr])
```

#### 功能描述
TRIM 函数用于去除字符串 `str` 左右两侧的指定字符（或空格）。如果不指定 `trimStr` 参数，则默认去除字符串左右两侧的所有空格字符。

#### 参数说明
- `str` (string): 需要进行处理的原始字符串。
- `trimStr` (string, 可选): 指定要去除的字符集，如果省略此参数，则默认去除空格字符。

#### 返回结果
返回处理后的字符串。

#### 使用示例
1. 去除字符串两端的空格：
   ```sql
   > SELECT '  Hello, World!  ' AS original, TRIM(original) AS trimmed;
    +----------------+--------+
    | original       | trimmed |
    +----------------+--------+
    |  Hello, World!  | Hello, World! |
    +----------------+--------+
   ```
2. 去除字符串两端的特定字符（例如星号）：
   ```sql
   > SELECT '**Hello, World!**' AS original, TRIM('**Hello, World!**' ,'**' ) AS trimmed;
    +----------------+--------+
    | original       | trimmed |
    +----------------+--------+
    | **Hello, World!** | Hello, World! |
    +----------------+--------+
   ```
3. 去除字符串左侧的零字符：
   ```sql
   > SELECT '000Hello, World!' AS original, TRIM('000Hello, World!', '0' ) AS trimmed;
    +----------------+--------+
    | original       | trimmed |
    +----------------+--------+
    | 000Hello, World! | Hello, World! |
    +----------------+--------+
   ```
4. 去除字符串右侧的百分号：
   ```sql
   > SELECT 'Hello, World!%' AS original, TRIM('Hello, World!%', '%' ) AS trimmed;
    +----------------+--------+
    | original       | trimmed |
    +----------------+--------+
    | Hello, World!% | Hello, World! |
    +----------------+--------+
   ```

