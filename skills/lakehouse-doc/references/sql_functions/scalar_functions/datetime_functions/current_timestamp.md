### CURRENT_TIMESTAMP 函数
```
current_timestamp()
```
#### 功能描述
`CURRENT_TIMESTAMP` 函数是一个非确定性函数，用于返回当前查询开始执行时的时间戳。在同一个查询中，无论调用多少次 `CURRENT_TIMESTAMP` 函数，返回的时间戳都是相同的。该函数对于记录查询执行的起始时间非常有用，尤其是在需要对时间敏感的数据分析和事务处理中。

#### 参数说明
无需提供任何参数。

#### 返回类型
该函数返回一个 `timestamp_ltz` 类型的时间戳。

#### 使用示例
1. 查询当前时间戳：
   ```sql
   SELECT current_timestamp();
   ```
   执行结果：
   ```
   2022-01-01 15:17:22.098368
   ```

2. 在插入数据时记录当前时间戳：
   ```sql
   INSERT INTO my_table (id, name, created_at) VALUES (1, 'John Doe', current_timestamp());
   ```
   这条语句会在插入新记录时，将当前时间戳作为 `created_at` 字段的值。

3. 比较查询前后的时间戳差异：
   ```sql
   SELECT current_timestamp() AS start_time;
   -- 执行一些查询操作 --
   SELECT current_timestamp() AS end_time;
   ```
   这将分别记录查询开始和结束的时间戳，可用于分析查询执行的耗时。

4. 与时间间隔结合使用，计算未来或过去的时间点：
   ```sql
   SELECT current_timestamp() + INTERVAL '1 day' AS tomorrow_date;
   ```
   执行结果：
   ```
    2024-04-08 20:03:39.170094
    ```

