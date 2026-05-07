### STRPOS
```sql
strpos(str, substr [, instance])
```

#### 功能
返回子串 substr 在字符串 str 中第一次出现（或第 instance 次出现）的位置。

#### 参数
* str: string 类型
* substr: string 类型，要查找的子串
* instance: int 类型（可选），指定要查找第几次出现，默认为 1

#### 返回结果
* int 类型，返回子串出现的位置（从 1 开始计数）
* 如果未找到子串，返回 0
* 如果任一参数为 NULL，返回 NULL
* 如果 instance 小于等于 0，返回 0

#### 举例
```sql
> SELECT strpos('high', 'ig');
2

> SELECT strpos('high', 'igx');
0

> SELECT strpos('Quadratically', 'a');
3

> SELECT strpos('abc/xyz/foo/bar', '/', 1);
4

> SELECT strpos('abc/xyz/foo/bar', '/', 2);
8

> SELECT strpos('abc/xyz/foo/bar', '/', 3);
12

> SELECT strpos('abc/xyz/foo/bar', '/', 4);
0

> SELECT strpos('信念,爱,希望', '爱');
4

> SELECT strpos('信念,爱,希望', '希望');
6

> SELECT strpos('', '');
1

> SELECT strpos(null, '');
NULL
```

#### 说明
* 位置索引从 1 开始计数（而非 0）
* 支持 Unicode 字符串
* 当 instance 参数超过实际出现次数时返回 0
* 空字符串作为 substr 参数时，如果 str 非空则返回 1；如果 str 和 substr 都为空，也返回 1。
