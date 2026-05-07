# VIEW（视图）
视图是一种虚拟表，它是由 SQL 查询定义的。通过创建视图，您可以像查询普通表一样查询视图。当用户查询视图时，查询结果将仅包含在定义视图的查询中指定的表和字段的数据。

## 视图的优势

1. 简化复杂的 SQL 查询：通过将复杂的查询定义为视图，您可以在需要时直接查询视图，而无需每次都重写复杂的查询。
2. 保护数据：视图可以限制用户访问基础表中的数据，只允许他们访问视图中定义的数据。
3. 更好的数据组织：视图可以帮助您更好地组织和管理数据，使其更易于理解和使用。

## 视图的限制

1. 视图是只读的，无法对视图执行 DML（插入、更新、删除）操作。
2. 视图的性能可能会受到基础表数据量和查询复杂度的影响。

## 视图管理

- [创建视图](CREATEVIEW.md)：通过指定 SQL 查询来创建视图。
- [删除视图](DROPVIEW.md)：删除已存在的视图。
- [查看视图详情](DESCVIEW.md)：查看视图的结构和定义。

## 使用案例

1. 计算利润和税后收入：

   ```
   CREATE VIEW v_sales AS
   SELECT revenue - cost AS profit, (revenue - cost) * tax_rate AS tax_amount, (revenue - cost) * (1 - tax_rate) AS net_income
   FROM table1;
   ```

2. 筛选特定部门的员工信息：

   ```
   CREATE VIEW v_sales_department AS
   SELECT id, name, position, salary
   FROM employees
   WHERE department = 'Sales';
   ```

3. 汇总每个月的销售数据：

   ```
   CREATE VIEW v_monthly_sales AS
   SELECT DATE_TRUNC('month', sale_date) AS month, SUM(revenue) AS total_sales
   FROM sales_data
   GROUP BY month;
   ```