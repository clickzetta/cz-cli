# JSON 数据处理

## 创建schema\table

```
CREATE SCHEMA IF NOT EXISTS clickzetta_demo_json_schema;
use schema clickzetta_demo_json_schema;
create table if not exists clickzetta_demo_json_schema.user_infor(info json);
insert into table  clickzetta_demo_json_schema.user_infor values
  (JSON '{"name": "张三","age": 25,"gender": "男","email": "zhangsan@example.com","phone": "13812xxx","address": "北京市朝阳区"}'),
  (JSON '{"name": "李四","age": 23, "gender": "女","email": "lisi@example.com","phone": "139876xxx1","address": "上海市浦东新区"}'),
  (JSON '{"name": "王五", "age": 27,"gender": "男","email": "wangwu@example.com","phone": "1376xxxxx8","address": "广州市天河区"}'),
  (JSON '{"name": "赵六","age": 24,"gender": "女","email": "zhaoliu@example.com","phone": "1369xxxx2","address": "深圳市南山区"}'),
  (JSON '{"name": "孙七","age": 26, "gender": "男","email": "sunqi@example.com","phone": "1351xxxx679","address": "杭州市西湖区"}'),
  (JSON '{"name": "周八","age": 22,"gender": "女","email": "zhouba@example.com","phone": "1347xxxx19","address": "南京市鼓楼区"}'),
  (JSON '{"name": "吴九","age": 28,"gender": "男","email": "wujiu@example.com","phone": "13345xxxx01","address": "成都市武侯区"}'),
  (JSON '{"name": "郑十","age": 21,"gender": "女","email": "zhengshi@example.com","phone": "1326xxx123","address": "重庆市渝北区"}'),
  (JSON '{"name": "陈十一","age": 29,"gender": "男","email": "chenshiyi@example.com","phone": "131xxxx789","address": "西安市碑林区"}'),
  (JSON '{"name": "林十二", "age": 20,"gender": "女","email": "linshier@example.com","phone": "130xxxx5432","address": "厦门市思明区"}');
```

## 使用json\_extract解析数据

```
select json_extract_string(info,"$.address") as address,
      json_extract_int(info,"$.age") as age,
      json_extract_string(info,"$.email") as email
from clickzetta_demo_json_schema.user_infor;
```

![](.topwrite/assets/image_1718703925062.png)

## 清理

```
drop schema if exists clickzetta_demo_json_schema;
```

## Congratulations, it's done.

Please enojoy and learn more!

## 附录

### 下载Zeppelin Notebook源文件

本文代码也提供运行在[Zeppelin](eco_integration/Zeppelin.md)的版本，你如果想直接运行本文代码，请按照文档说明安装[Zeppelin](eco_integration/Zeppelin.md)。

[03.JSON数据处理.ipynb](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/zeppelin_notebook/03.JSON%E6%95%B0%E6%8D%AE%E5%A4%84%E7%90%86.ipynb)
