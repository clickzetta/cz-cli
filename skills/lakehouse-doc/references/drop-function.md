# DROP FUNCTION

## **功能描述**

删除当前或指定 schema 下的外部函数。需要注意的是，删除函数后，无法恢复该函数，只能重新创建。此外，删除函数并不会清理存储在对象存储中的函数代码和可执行文件。

## **语法**

```
DROP FUNCTION [IF EXISTS] <function_name>;
```

## **参数说明**

- `<function_name>`：指定的外部函数名称。
- `IF EXISTS`：可选参数，用于判断函数是否存在。如果存在，则删除函数；如果不存在，则不执行任何操作。


## **使用说明**

- 删除函数时，建议先使用 `IF EXISTS` 参数进行判断，以避免因函数不存在而导致的错误。
- 删除函数后，需要重新创建函数并重新加载函数代码和可执行文件。

**示例**

1.  删除名为 `ext_to_upper` 的外部函数。

    ```
   drop function if exists ext_to_upper;
   ```

2.  删除名为 `ext_to_upper` 的外部函数及其依赖的所有对象。

    ```
   drop function ext_to_upper ;
   ```
