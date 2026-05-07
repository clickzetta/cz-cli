# 验证SchemaEvolution的操作结果

云器Lakehouse Schema Evolution 支持通过ALTER语句变更表中的列，支持添加列、修改列、删除列。修改列包括修改列名和列的数据类型。支持修改复杂类型变化。
本文给出对应实例，方便验证SchemaEvolution的操作结果，快速理解Schema Evolution的结果，验证实现是否符合预期。

## 创建schema和表

```
CREATE SCHEMA IF NOT EXISTS clickzetta_demo_schema_evolution_schema;
USE SCHEMA clickzetta_demo_schema_evolution_schema;
CREATE TABLE if not exists clickzetta_demo_schema_evolution_schema.schema_evolution (
    t_tinyint tinyint,
    t_snmallint smallint,
    t_int int,
    t_bigint bigint,
    t_float float,
    t_double double,
    t_decimal decimal(5,2)
)partitioned by(pt string);
```

## 插入数据

```
insert into clickzetta_demo_schema_evolution_schema.schema_evolution select 1y,234s,10000,100000000,0.2f,0.004d,123.1bd,'202231120';
```

## 分区表加列必须指定位置，否则添加的列会在最后一列

```
ALTER TABLE clickzetta_demo_schema_evolution_schema.schema_evolution ADD COLUMN t_add int comment 'add';
```

```
desc clickzetta_demo_schema_evolution_schema.schema_evolution;
```

![](.topwrite/assets/image_1718704848571.png)

## 在指定位置增加列

```
ALTER TABLE clickzetta_demo_schema_evolution_schema.schema_evolution ADD COLUMN t_add2 int comment 'add' after t_decimal;
desc clickzetta_demo_schema_evolution_schema.schema_evolution;
```

![](.topwrite/assets/image_1718704923098.png)

## 删除列

```
ALTER TABLE clickzetta_demo_schema_evolution_schema.schema_evolution DROP   COLUMN t_add;
desc clickzetta_demo_schema_evolution_schema.schema_evolution;
```

## 重命名列

```
ALTER TABLE clickzetta_demo_schema_evolution_schema.schema_evolution rename COLUMN t_add2 to t_add;
desc clickzetta_demo_schema_evolution_schema.schema_evolution;
select * from clickzetta_demo_schema_evolution_schema.schema_evolution;
```

## 修改字段位置

```
ALTER TABLE clickzetta_demo_schema_evolution_schema.schema_evolution change COLUMN t_add  after t_tinyint ;
select * from clickzetta_demo_schema_evolution_schema.schema_evolution;
```

## 修改数据类型

```
ALTER TABLE clickzetta_demo_schema_evolution_schema.schema_evolution change COLUMN t_decimal  type DECIMAl(7,4) ;
select * from clickzetta_demo_schema_evolution_schema.schema_evolution;
```

不支持的类型转换会报错

```
ALTER TABLE clickzetta_demo_schema_evolution_schema.schema_evolution change COLUMN t_decimal  type date ;
```

\##修改字段comment

```
ALTER TABLE clickzetta_demo_schema_evolution_schema.schema_evolution change COLUMN t_tinyint  comment 'mysmallint';
desc clickzetta_demo_schema_evolution_schema.schema_evolution;
```

## 复杂类型修改

### 创建表

```
 CREATE TABLE clickzetta_demo_schema_evolution_schema.schema_evolution_01 (
  point struct<x: int, y: double>,
  points array<struct<x: double, y: double>>,
  points_ky map<struct<x: int>, struct<a: int>>
    );
```

### 插入数据

```
insert into clickzetta_demo_schema_evolution_schema.schema_evolution_01 values(struct(1D,2D),array(struct(1D,2D)),null);
```

### 添加列

```
ALTER TABLE clickzetta_demo_schema_evolution_schema.schema_evolution_01 ADD COLUMN point.z double ;
select * from clickzetta_demo_schema_evolution_schema.schema_evolution_01;
```

### 删除point struct中的z列

```
ALTER TABLE clickzetta_demo_schema_evolution_schema.schema_evolution_01 DROP COLUMN point.z;
select * from clickzetta_demo_schema_evolution_schema.schema_evolution_01;
```

### 重命名point struct中的x列

```
ALTER TABLE clickzetta_demo_schema_evolution_schema.schema_evolution_01 rename COLUMN point.x to xx;
select * from clickzetta_demo_schema_evolution_schema.schema_evolution_01;
```

### 删除array嵌套struct中的y的列

```
ALTER TABLE clickzetta_demo_schema_evolution_schema.schema_evolution_01 DROP COLUMN points.element.y;
desc clickzetta_demo_schema_evolution_schema.schema_evolution_01;
```

## 修改struct类型

```
ALTER TABLE clickzetta_demo_schema_evolution_schema.schema_evolution_01 CHANGE COLUMN point.xx type bigint;
desc clickzetta_demo_schema_evolution_schema.schema_evolution_01;
```

### 修改复杂类型位置

```
ALTER TABLE clickzetta_demo_schema_evolution_schema.schema_evolution_01 CHANGE COLUMN point.y first;
select * from clickzetta_demo_schema_evolution_schema.schema_evolution_01;
```

## 清理

```
DROP SCHEMA IF EXISTS clickzetta_demo_schema_evolution_schema;
```

## Congratulations, it's done.

Please enojoy and learn more!

## 附录

### 下载Zeppelin Notebook源文件

本文代码也提供运行在[Zeppelin](eco_integration/Zeppelin.md)的版本，你如果想直接运行本文代码，请按照文档说明安装[Zeppelin](eco_integration/Zeppelin.md)。

[03.Schema Evolution.ipynb](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/zeppelin_notebook/03.Schema%20Evolution.ipynb)
