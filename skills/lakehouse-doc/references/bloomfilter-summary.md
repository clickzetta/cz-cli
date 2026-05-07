# BloomFilter Index
## Bloom Filter索引的原理介绍
1. **数据结构**：Bloom Filter 由一个位数组（BitSet）和多个哈希函数组成。位数组初始时所有位都设置为 0。
2. **元素添加**：当向集合中添加一个元素时，通过多个哈希函数计算出该元素在位数组中的多个位置，并将这些位置的位设置为1。
3. **元素查询**：查询元素是否存在时，同样通过哈希函数计算出该元素可能在位数组中的位置，检查这些位置是否都为1。如果所有位都为1，则认为元素可能存在于集合中；如果任何一个位不为1，则可以确定元素不存在于集合中。
4. **优点**：
   * 空间效率和查询时间都远远超过一般算法，存储空间和插入/查询时间都是常数 O(k)。
   * 哈希函数相互之间没有关系，方便硬件并行实现。
   * 不需要存储元素本身，在对保密要求严格的场合有优势。
5. **缺点**：
   * 随着存入的元素数量增加，误判率随之增加，即假阳性（False Positive）概率增加。
   * 一般情况下不能从Bloom Filter中删除元素。
6. **应用场景**：
   * Bloom Filter 索引适用于基数较高的列，如 ID 列，可以快速判断表的数据文件中是否可能包含要查询的数据，如果不包含就跳过，从而减少扫描的数据量。
   * 适用于等值查询（包括 = 和 IN），对高基数字段效果较好，如 USER-ID 等唯一 ID 字段。对低基数字段的加速效果有限，如“性别”字段。

7. **误判率（False Positive）**：Bloom Filter 可能出现将不在集合中的元素误判为在集合中的情况，但绝不会出现将集合中的元素误判为不在集合中的情况。
## Bloom Filter在Lakehouse中的应用

Bloom Filter 索引是一种高效的数据结构，用于快速判断数据文件中是否包含特定的数据。通过为某个列创建 Bloom Filter 索引，系统会为该列生成一个 Bloom Filter。在执行查询操作时，可以利用这个索引跳过不需要的数据文件，从而减少扫描数据量，提高查询性能。Bloom Filter 特别适用于基数较高的列。

例如，当执行一个查询操作，如 `SELECT * FROM table WHERE col_name = 'xxx'`，BloomFilter 会先判断目标数据文件中是否可能包含该值。如果不可能存在，系统将跳过该文件，避免不必要的读取。如果索引判断文件中可能存在目标数据，则会读取文件进行进一步查询。

BloomFilter 索引在以下操作中生效：`AND`, `OR`, `IN`, `=`。需要注意的是，创建完 Bloom Filter 索引后，只有新写入的数据才会包含该索引。对于旧数据，建议使用 `INSERT OVERWRITE` 语句进行重写，以添加索引。

### Bloom Filter具体使用场景

**场景一：大数据量下的等值查询**

**案例**：
假设有一个用户表 `users`，其中包含数百万条用户记录，表结构如下：

```SQL
CREATE TABLE users (
    user_id INT,
    username VARCHAR(255),
    email VARCHAR(255)
);
```

在这个表中，`email` 字段的基数很高，即大多数用户都有唯一的邮箱地址。如果我们经常需要根据邮箱地址来查询用户信息，可以为 `email` 字段创建一个 Bloom Filter 索引。

**创建索引**：

```SQL
CREATE BLOOMFILTER INDEX idx_email ON TABLE users(email);
```

**查询**：

当我们需要查询特定邮箱的用户时，可以使用如下查询：

```SQL
SELECT * FROM users WHERE email = 'user@example.com';
```

* **快速排除**：Bloom Filter 可以帮助数据库快速判断 `user@example.com` 是否可能在表中。如果 Bloom Filter 确定该邮箱不可能在表中，那么相关的数据文件将被跳过，从而减少 I/O 操作和查询时间。
* **提升性能**：对于大数据量的表，这种快速排除可以显著提升查询性能。

**场景二：高基数列的查询优化**

**案例**：

假设有一个商品表`products`，其中包含商品的各种属性，表结构如下：

```SQL
CREATE TABLE products (
    product_id INT,
    category VARCHAR(100),
    price DECIMAL(10, 2)
);
```

在这个表中，`category` 字段的基数非常高，因为商品可以属于不同的类别。如果我们经常需要根据类别来查询商品，可以为 `category` 字段创建一个 Bloom Filter 索引。

**创建索引**：

```SQL
CREATE BLOOMFILTER INDEX idx_category ON TABLE products(category);
```

**查询**：

当我们需要查询特定类别的商品时，可以使用如下查询：

```SQL
SELECT * FROM products WHERE category = 'Electronics';
```

*   **减少扫描**：Bloom Filter 可以减少需要扫描的数据量，因为对于不包含目标类别的数据文件，Bloom Filter 可以帮助跳过它们。
*   **提高效率**：在高基数列上，Bloom Filter 可以提高查询效率，尤其是在数据量庞大的情况下。

### 注意事项

* **误报概率**：Bloom Filter有一个定义的误报概率（FPP），这意味着它可能会错误地认为某个值存在于表中。因此，即使Bloom Filter表明某个值可能存在，实际查询时仍可能找不到该值。
* **写操作成本**：Bloom Filter 在写操作（如插入、更新、删除）时可能会有更高的成本，因为需要更新 Bloom Filter 数据结构。
* **不支持的数据类型**：Bloom Filter不支持interval、struct、map、array等复杂数据类型，因此在创建索引时需要注意列的数据类型。


## 创建 Bloom Filter 索引

[创建 BloomFilter索引](<CREATE-BLOOMFILTER-INDEX.md>)

要为某个列创建 Bloom Filter 索引，您可以使用以下语句：

```
CREATE BLOOMFILTER INDEX index_name ON table_name (column_name);
```

例如，为表 `employees` 中的 `email` 列创建一个名为 `email_bloomfilter` 的索引：

```
CREATE BLOOMFILTER INDEX email_bloomfilter ON employees (email);
```

## 查看 Bloom Filter 索引详情

[查看BOOLFILTER索引详情](<DESC-INDEX.md>)

要查看表上的 BloomFilter 索引详情，可以使用 `DESCRIBE INDEX` 语句：

```
DESCRIBE INDEX index_name ON table_name;
```

例如，查看 `employees` 表上名为 `email_bloomfilter` 的索引详情：

```
DESCRIBE INDEX email_bloomfilter ON employees;
```

## 删除 Bloom Filter 索引

[删除 BloomFilter索引](<DROP-INDEX.md>)


要删除一个 Bloom Filter 索引，可以使用 `DROP INDEX` 语句：

```
DROP INDEX index_name ON table_name;
```

例如，删除 `employees` 表上名为 `email_bloomfilter` 的索引：

```
DROP INDEX email_bloomfilter ON employees;
```

## 列出表上的 Bloom Filter 索引

[列出表上的 BloomFilter索引](<SHOW-INDEX.md>)

要查看表上的所有 BloomFilter 索引，可以使用 `SHOW INDEXES` 语句：

```
SHOW INDEXES ON table_name;
```

例如，查看 `employees` 表上的所有索引：

```
SHOW INDEXES ON employees;
```

