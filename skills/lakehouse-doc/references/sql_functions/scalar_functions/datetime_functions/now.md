### NOW 函数
#### 简介
`now` 函数是一个非确定性函数，用于返回当前的时间戳。在执行一个查询（query）过程中，无论调用多少次 `now` 函数，返回的时间戳都是相同的，即从查询开始的那一刻起固定下来的。

#### 语法
```
now()
```
#### 参数
无

#### 返回结果类型
`timestamp_ltz`

#### 使用示例
以下是一个简单的使用 `now` 函数的例子：

```sql
SELECT now();
```

执行上述 SQL 语句后，将返回类似于以下的结果，具体时间会根据查询执行时的实际时间而变化：

```
2022-01-01 15:17:22.098368
```

#### 更多例子
1. 插入数据时使用当前时间戳作为记录创建时间：

```sql
INSERT INTO my_table (id, name, created_at) VALUES (1, 'John Doe', now());
```

2. 在更新数据时，使用当前时间戳作为记录最后更新时间：

```sql
UPDATE my_table SET name = 'Jane Doe', updated_at = now() WHERE id = 1;
```

3. 选择数据时，过滤出在过去 24 小时内创建的记录：

```sql
SELECT * FROM my_table WHERE created_at > now() - INTERVAL '1 day';
```

4. 比较当前时间与记录的最后更新时间，判断记录是否在最近一小时内有变动：

```sql
SELECT * FROM my_table WHERE updated_at > now() - INTERVAL '1 hour';
```

通过以上示例，您可以更好地理解 `CURRENT_TIMESTAMP` 函数在实际应用中的使用场景。