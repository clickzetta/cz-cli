### 替换函数 (REPLACE)
```sql
replace(str, search [, replace])
```
#### 功能描述
该函数用于在字符串 `str` 中查找子字符串 `search` 并将找到的内容替换为 `replace` 字符串。如果没有提供 `replace` 参数，则默认将 `search` 替换为空字符串。

#### 参数说明
- `str` (string): 需要进行操作的原始字符串。
- `search` (string): 需要在 `str` 中查找并替换的子字符串。
- `replace` (string, 可选): 用于替换找到的 `search` 子字符串的目标字符串。如果未提供该参数，则默认删除 `search` 子字符串。

#### 返回结果
返回一个新的字符串，其中 `str` 中的 `search` 子字符串已被替换为 `replace` 字符串，或者如果未提供 `replace` 参数，则删除 `search` 子字符串。

#### 使用示例
1. 将字符串 "Hello World" 中的 "World" 替换为 "Java"：
```sql
> SELECT replace('Hello World', 'World', 'Java');
'Hello Java'
```
2. 删除字符串 "100-500" 中的 "100"：
```sql
> SELECT replace('100-500', '100');
'-500'
```
3. 将字符串 "12345" 中的所有 "3" 替换为 "X"：
```sql
> SELECT replace('12345', '3', 'X');
'12X45'
```
4. 将字符串 "data-science" 中的所有短横线（"-"）替换为下划线（"_"）：
```sql
> SELECT replace('data-science', '-', '_');
'data_science'
```
通过这些示例，您可以看到 `replace` 函数在处理字符串时非常灵活且易于使用。您可以根据需要轻松地替换或删除字符串中的特定内容。