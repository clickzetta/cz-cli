# Lakehouse Map Join优化操作

## 简介

Map Join 是 Lakehouse 中一种高效的 JOIN 操作方式，特别适用于小表与大表的 JOIN 场景。Map Join 通过将小表广播到各个节点，直接在 Map 阶段完成 JOIN 操作，从而避免了昂贵的 Shuffle 和 Reduce 过程。这种优化方式可以节省资源，提高查询性能。

## 语法

要使用 Map Join，只需在查询语句中添加一个提示 `/*+ MAPJOIN (table) */`，其中 `table` 表示需要加载到内存中的小表名称。例如：

```SQL
SELECT /*+ MAPJOIN (t2) */ * FROM table1 t1
JOIN table2 t2
ON (t1.emp_id = t2.emp_id);
```

在这个例子中，`table2` 是一个小表，通过 Map Join 的方式，它会被加载到内存中，并与 `table1` 在 Map 阶段完成 JOIN 操作。

## 优点

Map Join 具有以下优点：

1. 省去了 Shuffle 阶段，减少了网络传输和磁盘 I/O 的开销。
2. 避免了数据倾斜问题，因为不需要按照 JOIN 列进行数据分发。
3. 提高了查询执行速度，尤其对于小表 JOIN 大表的场景。

## 缺点

Map Join 存在以下限制：

1. 小表必须能够完全加载到内存中，否则可能导致内存溢出或 Map Join 失败。目前 Lakehouse 限制小表大小为 1GB。
2. Map Join 仅适用于小表与大表的 JOIN 操作，对于大表与大表的 JOIN 场景，则无法发挥优势。

## 使用示例

以下是一些 Map Join 的使用示例：

### 示例1：员工信息与部门信息的关联查询

```SQL
SELECT /*+ MAPJOIN (dept) */ * FROM employees emp
JOIN departments dept
ON (emp.dept_id = dept.dept_id);
```

### 示例2：订单信息与客户信息的关联查询

```SQL
SELECT /*+ MAPJOIN (customer) */ * FROM orders order_
JOIN customers customer
ON (order_.customer_id = customer.customer_id);
```

### 示例3：销售记录与员工信息的关联查询

```SQL
SELECT /*+ MAPJOIN (employee) */ * FROM sales sales_
JOIN employees employee
ON (sales_.employee_id = employee.employee_id);
```

通过以上示例，您可以看到 Map Join 在不同场景下的应用。在实际使用中，请确保小表能够完全加载到内存中，以充分发挥 Map Join 的优势。