### INSTR 函数
```sql
instr(str, substr)
```
#### 功能描述
INSTR 函数用于查找指定子字符串（substr）在给定字符串（str）中第一次出现的位置。当 substr 在 str 中被找到时，返回其起始位置的整数索引（从 1 开始计数）；若未找到，则返回 0。

#### 参数说明
- str: 待搜索的字符串。
- substr: 需要查找的子字符串。

#### 返回结果
返回一个整数，表示 substr 在 str 中第一次出现的位置。如果 substr 未在 str 中出现，则返回 0。

#### 使用示例
1.  查询子字符串 "World" 在 "HelloWorld" 中的位置：
    ```sql
SELECT INSTR('HelloWorld', 'World'); -- 结果为：6
```
2.  查询子字符串 "Java" 在 "HelloWorld" 中的位置（预期未找到，返回 0）：
    ```sql
SELECT INSTR('HelloWorld', 'Java'); -- 结果为：0
```
3.  计算子字符串 "or" 在 "HelloWorld" 中的起始位置：
    ```sql
SELECT INSTR('HelloWorld', 'or'); -- 结果为：7
```
4.  在一个更长的文本中查找子字符串 "Program" 的位置：
    ```sql
SELECT INSTR('Programming in C language is fun', 'Program'); -- 结果为：1
```
5.  当 substr 为空字符串时，返回 1，因为空字符串被视为存在于任何字符串的开头。
    ```sql
SELECT INSTR('HelloWorld', ''); -- 结果为：1
```
#### 注意事项
- 如果 str 或 substr 为 NULL，则 INSTR 函数返回 NULL。
- 搜索是区分大小写的，即 'Hello' 和 'hello' 被视为不同的字符串。
- 若要执行不区分大小写的搜索，可先使用 UPPER 或 LOWER 函数转换 str 和 substr 为同一大小写形式，然后再进行比较。

通过以上示例和说明，您可以更好地理解 INSTR 函数的用法和功能。在实际应用中，您可以根据需要灵活地使用此函数来查找特定子字符串的位置。