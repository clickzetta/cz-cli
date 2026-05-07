# Dynamic Table 支持DML语句修改数据

Dynamic Table (DT) 提供了对数据的直接修改能力，通过 DML（Data Manipulation Language）语句实现数据的插入、更新和删除操作。但出于安全考虑，这些操作默认是禁用的，以防止误操作导致数据损坏。若需启用 DML 操作，用户必须显式设置系统参数：`SET cz.sql.dt.allow.dml = true;`

启用后，DT将支持以下DML操作：

*   **插入操作**：支持 `INSERT` 和 `INSERT OVERWRITE` 语句。
*   **删除操作**：支持 `DELETE` 和 `TRUNCATE` 语句。

**注意事项**

*   **全量刷新**：一旦对 DT 进行了 DML 修改，下一次数据刷新将自动转为全量刷新。这是因为中间计算结果的状态将变得不可预测，为了保证数据的一致性和准确性，系统将重新计算所有数据。
*   **参数化定义的带分区的 DT**：对于参数化定义且带有分区的 DT，如果仅修改了部分分区，未被修改的分区仍然可以维持增量刷新。

## 插入数据

```SQL
CREATE dynamic table  event_gettime_pt 
partitioned by(event_day)
AS SELECT
  event,
  process,
  YEAR(event_time) event_year,
  MONTH(event_time) event_month,
  DAY(event_time) event_day
FROM event_tb_pt
where day(event_time)=SESSION_CONFIGS()['dt.args.event_day'];
insert into  event_gettime values('event-update',20,2024,9,19);
select * from event_gettime;
```

## 删除数据

```SQL
CREATE dynamic table  event_gettime_pt 
partitioned by(event_day)
AS SELECT
  event,
  process,
  YEAR(event_time) event_year,
  MONTH(event_time) event_month,
  DAY(event_time) event_day
FROM event_tb_pt
where day(event_time)=SESSION_CONFIGS()['dt.args.event_day'];
set cz.sql.dt.allow.dml=true;
delete  from event_gettime  where event_day=19;
select * from event_gettime;
```
