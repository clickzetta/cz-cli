### LTRIM 函数
```
LTRIM(str [, trimStr])
```
#### 功能描述
LTRIM 函数用于去除字符串 `str` 左侧的指定字符或空格。如果未提供 `trimStr` 参数，则默认删除 `str` 左侧的所有空格。

#### 参数说明
- `str` (string): 需要处理的原始字符串。
- `trimStr` (string, 可选): 指定要从 `str` 左侧删除的字符集。

#### 返回结果
返回处理后的字符串。

#### 使用示例
1. 删除字符串左侧的所有空格：
   ```sql
   SELECT 'X' || LTRIM('    HelloWorld    ') || 'X';
   -- 结果：XHelloWorld    X
   ```
   
2. 删除字符串左侧的特定字符：
   ```sql
   SELECT LTRIM('HelloWorld', 'He');
   -- 结果：World
   ```
   
3. 删除字符串左侧的多个字符（字符集）：
   ```sql
   SELECT LTRIM('!!!HelloWorld!!!', '!');
   -- 结果：HelloWorld
   ```
   
4. 当 `trimStr` 为空字符串时，不会对 `str` 进行任何操作：
   ```sql
   SELECT LTRIM('Hello', '');
   -- 结果：Hello
   ```
   
5. 如果 `trimStr` 中包含 `str` 中不存在的字符，LTRIM 函数仍会删除 `str` 左侧的空格：
   ```sql
   SELECT LTRIM('Hello', 'abc');
   -- 结果：Hello
   ```

#### 注意事项
- 当 `trimStr` 参数为空或仅包含空格时，LTRIM 函数的行为与 `LTRIM` 函数的默认行为相同，即删除字符串左侧的所有空格。
- 如果 `trimStr` 参数中包含非打印字符或特殊字符，这些字符也会被用于去除 `str` 左侧的字符。