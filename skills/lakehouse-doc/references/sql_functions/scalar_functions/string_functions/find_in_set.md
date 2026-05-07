### FIND_IN_SET
```sql
split_part(str, strlist)
```
#### 功能
strlist 是由 N 个被 ‘,’ 分隔的子串组成的字符串。假如字符串 str 在 strlist 中，则返回 str 的位置（1 到 N 之间）。
如果 str 不在 strlist 中或 strlist 为空字符串，则返回值为 0。
如任意一个参数为 NULL，则返回值为 NULL。
这个函数在第一个参数包含一个逗号 ‘,’ 时将无法正常运行。
#### 参数
* str: string, 待匹配字符串
* strlist: string, 待查找字符串
#### 返回结果
int
#### 举例
```sql
> SELECT FIND_IN_SET('b','a,b,c,d');
2
```
