### MAKE_DATE
```sql
make_date(year, month, day)
```
#### 功能
根据年、月、日构造一个 date 类型的值。

#### 参数
* `year`: int
* `month`: int
* `day`: int

#### 返回值
date 类型

#### 示例
```sql
> SELECT make_date(2000, 2, 28);
2000-02-28
```
