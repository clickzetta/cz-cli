# 数据类型转换

数据类型转换是指将一种数据类型的值转换为另一种数据类型的值的过程。数据类型转换可以分为隐式转换和显式转换。隐式转换是指在执行某些操作时，系统自动进行的数据类型转换，例如算术运算、比较运算、函数调用等。显式转换是指用户使用特定的函数或语法来指定数据类型转换，例如CAST等。不同的数据库系统可能有不同的数据类型转换规则和函数。本文将介绍lakehouse的数据类型转换特点和用法

# 显式转换

Lakehouse支持两种方式进行显式类型转换：使用 `CAST` 函数或使用 `::` 符号。这两种方式是等价的，例如 `CAST(a AS INT)` 等价于 `a::INT`。`::` 符号提供了更简洁的语法来执行类型转换。

下图显示使用cast转换的行为，

| Source\Target  | tinyint | Smallint | Int   | Bigint | Float | Double | Decimal | String | Date  | Timestamp\_ltz | Timestamp\_ntz | Interval | Boolean | Binary | Array | Map   | Struct |
| -------------- | ------- | -------- | ----- | ------ | ----- | ------ | ------- | ------ | ----- | -------------- | -------------- | -------- | ------- | ------ | ----- | ----- | ------ |
| Tinyint        | **Y**   | Y        | *Y*   | Y      | Y     | Y      | Y       | Y      | N     | N              | N              | N        | Y       | N      | N     | N     | N      |
| Smallint       | **Y**   | **Y**    | Y     | Y      | Y     | Y      | Y       | Y      | N     | N              | N              | N        | Y       | N      | N     | N     | N      |
| Int            | **Y**   | **Y**    | **Y** | Y      | Y     | Y      | Y       | Y      | N     | N              | N              | N        | Y       | N      | N     | N     | N      |
| Bigint         | **Y**   | **Y**    | **Y** | **Y**  | Y     | Y      | Y       | Y      | N     | Y              | Y              | N        | Y       | N      | N     | N     | N      |
| Float          | **Y**   | **Y**    | **Y** | **Y**  | **Y** | Y      | Y       | Y      | N     | N              | N              | N        | N       | N      | N     | N     | N      |
| Double         | **Y**   | **Y**    | **Y** | **Y**  | **Y** | **Y**  | Y       | Y      | N     | N              | N              | N        | N       | N      | N     | N     | N      |
| Decimal        | **Y**   | **Y**    | **Y** | **Y**  | **Y** | **Y**  | **Y**   | **Y**  | N     | N              | N              | N        | N       | N      | N     | N     | N      |
| String         | **Y**   | **Y**    | **Y** | **Y**  | **Y** | **Y**  | **Y**   | Y      | **Y** | **Y**          | **Y**          | **Y**    | **Y**   | **Y**  | N     | N     | N      |
| Date           | N       | N        | N     | N      | N     | N      | N       | Y      | Y     | Y              | Y              | N        | N       | N      | N     | N     | N      |
| Timestamp\_ltz | N       | N        | N     | Y      | N     | N      | N       | Y      | Y     | Y              | Y              | N        | N       | N      | N     | N     | N      |
| timestmap\_ntz | N       | N        | N     | N      | N     | N      | N       | Y      | Y     | Y              | Y              | N        | N       | N      | N     | N     | N      |
| Interval       | N       | N        | N     | N      | N     | N      | N       | Y      | N     | N              | N              | Y        | N       | N      | N     | N     | N      |
| Boolean        | Y       | Y        | Y     | Y      | Y     | Y      | Y       | Y      | N     | N              | N              | N        | Y       | N      | N     | N     | N      |
| Binary         | N       | N        | N     | N      | N     | N      | N       | Y      | N     | N              | N              | N        | N       | Y      | N     | N     | N      |
| Array          | N       | N        | N     | N      | N     | N      | N       | Y      | N     | N              | N              | N        | N       | N      | **Y** | N     | N      |
| Map            | N       | N        | N     | N      | N     | N      | N       | Y      | N     | N              | N              | N        | N       | N      | N     | **Y** | N      |
| Struct         | N       | N        | N     | N      | N     | N      | N       | Y      | N     | N              | N              | N        | N       | N      | N     | N     | **Y**  |

黑色加粗代表可能会报错或者转换为null，需要说明lakehouse为了避免用户写SQL转换值失败，采用了转换更宽松的行为，黑色加粗部分引发异常会转换为null，当然你也可以设置标准行为黑色加粗部分为严格模式也可以报错,开启严格模式set cz.sql.cast.mode=strict;开启后你可以直接使用[try\_cast](datatype-cast.md)函数报错行为将返回null，详情可以参考参数管理

* CAST(Numeric AS Numeric)：如果超出目标数据类型的范围，lakehouse默认会转换为null
* 将 FLOAT 转换为 INTEGER 对值进行截断
* 将 TIMESTAMP 转换为 DATE 会删除有关一天中时间的信息

# 隐式转换

当两个不同类型的值进行算术运算或比较运算时，Lakehouse SQL会按照一定的优先级进行隐式转换，以保证运算结果的精度和范围。优先级的顺序如下图。也就是说，如果两个值的类型不同，那么类型较低的值会被转换为类型较高的值，以匹配另一个值的类型。例如，当整数和小数进行加法运算时，整数会被转换为小数，以避免精度损失。当日期和时间戳进行比较运算时，日期会被转换为时间戳，以保证时间粒度的一致性。

![](.topwrite/assets/image_1700219556792.png)

图中类型由低到高排布最上层为最低类型

**特别注意**

lakehouse为了避免用户写SQL转换值失败，隐式转换和显式转化采用了转换更宽松的行为，引发异常会转换为null。你可以开启严格模式set cz.sql.cast.mode=strict;详情可以参考参数管理
比如

```
--18.234超过了指定的转化范围，使用cast转化如果没有开启严格模式结果为null
SELECT cast(18.234 AS decimal(4, 3)) AS res;
+------+
| res  |
+------+
| null |
+------+
--开启严格模式，则会报错精度异常
set cz.sql.cast.mode=strict;
SELECT cast(18.234 AS decimal(4, 3)) AS res;
CZLH-22003:[1,8] cannot cast `18.234` to decimal32 due to an overflow. Use `try_cast` to tolerate overflow. Detail  taskId 0

```

# 案例

隐示转换

```SQL
--decimal和double运算
SELECT typeof(10bd +3.14D) ;
+----------------------+
| typeof(10BD + 3.14D) |
+----------------------+
| double               |
+----------------------+
```

显示转换

```SQL
SELECT CAST(‘123’ AS INT) 
```

^
