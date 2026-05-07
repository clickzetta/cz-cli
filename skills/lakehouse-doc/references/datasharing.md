# 数据分享

## 什么是数据分享

数据分享是云器Lakehouse提供的无复制数据共享功能，用于同服务区域下跨账户或跨服务实例的数据授权使用。在云器Lakehouse中，用户可通过share对象，向同服务区域内的其他账户分享指定table或view的数据，而不需要实际将数据复制给其他账户。

基于数据分享功能，账户间可便捷、安全地分享数据并与自身的数据进行关联计算，充分挖掘数据价值。

通过share对象分享的数据通过权限管控的方式保障数据安全，数据提供方可随时通过对share的权限管控取消指定数据的分享。

数据消费方无需对被分享的数据所占存储资源付费，但需要使用自身的计算资源处理被分享数据。当被分享数据发生变化时，数据消费方可以立即获得最新数据，无需进行数据同步。

:-: ![](.topwrite/assets/image_1704779759719.png =752)

## 典型应用场景

A企业需要将自身数据提供给其客户B企业使用，需要能做到数据实时更新且避免建立高成本的数据实时同步链路。此时A企业可创建share对象，将需要提供的数据授权至share对象，并将share指定给B企业在云器Lakehouse的服务实例。B企业即可立即使用A企业共享的数据。

## 注意事项

* 分享的数据均为“只读”，不允许消费方对数据进行修改、删除等操作。
* 创建share对象的工作空间决定了该share对象所能添加的数据对象范围。不支持跨工作空间添加数据对象。
* 一个share对象中最多分享1000个table或view对象。
* 如需对一个table中的部分数据进行分享，建议根据分享数据的需要，创建对应的view视图，然后将view视图进行分享。
* 分享的数据禁止数据消费方进行二次分享，以保护数据提供方的权益。
* 目前不能阻止数据消费方对分享数据的复制行为，因此需要数据提供方谨慎选择分享数据的范围。

## 数据分享的DDL命令

[CREATE SHARE](create-share.md)

[ALTER SHARE](alter-share.md)

[GRANT TO SHARE](grant-to-share.md)

[REVOKE FROM SHARE](revoke-from-share.md)

[SHOW SHARES](show-shares.md)

[DESC SHARE](desc-share.md)

[DROP SHARE](drop-share.md)

## 支持share的数据对象

当前支持share的数据对象有：table和view对象。

支持使用 all tables in schema \<schema\_name> 和 all views in schema \<schema\_name> 的方式，将指定schema下的所有table和view对象加入到共享对象share中。 该操作包含“未来”创建在指定schema中的所有table和view对象，请谨慎操作。

## 提供数据分享的操作

### Web端

**1. 创建share对象**

为保障数据安全，数据分享（share）对象必须由具备“实例管理员”（instance\_admin）角色的用户创建。点击左侧菜单的“数据管理”-“数据分享”，进入数据分享列表页。

点击“+新增分享”，打开新建数据分享窗口：

:-: ![](.topwrite/assets/image_1734492957409.png =507)

1）填写数据分享的“分享名称”。

2）选择“工作空间”，指将要分享的table或view所在的工作空间，一个数据分享（share）对象仅可包含一个工作空间下的数据。

3）在数据对象行，点击“添加”。选择数据分享中需要包含的具table或view，可以选择多个。但请注意，不可选择来源于其他数据分享的表和视图，因为数据分享的授权中不允许对数据进行二次分享。使用web端创建的数据分享仅支持包含已存在的table和view，暂不支持指定整个schema下“未来”创建的table或view对象。

4）在接收实例行，点击“添加”。输入需要接收数据的服务实例名称。服务实例名称在Lakehouse服务中全局唯一。服务消费端用户可在首页右侧或在服务实例的URL中找到自己的服务实例名称并提供给分享者进行配置。

:-: ![](.topwrite/assets/share_img_instancename.png =786)

^

*注意*：

1. *为保障以工作空间为隔离域的数据安全，仅具备工作空间管理员角色的用户可在数据分享（share）中添加其管理的工作空间内的数据对象*。
2. *创建数据分享（share）对象弹窗中的“创建”和“添加数据”是两个操作，即使添加要分享的数据全部失败或部分失败，并不会影响分享对象的创建。任意操作出现失败时，会返回报错信息。你可以在数据分享列表中点击已创建的数据分享，继续添加数据对象或要接收数据的服务实例*。

**2. 查询已创建数据分享（share）对象**

所有当前服务实例内已创建的数据分享（share）对象，均在“数据分享”列表页显示。具备服务实例管理员角色（instance\_admin)或工作空间管理员角色（workspace\_admin)的用户，可以查看数据分享（share）对象列表。

:-: ![](.topwrite/assets/image_1734493289109.png =737)

**3. 查询数据分享（share）详情**

在“数据分享”列表页显示点击具体的数据分享名称，即可查询该数据分享的详细信息，包括基础信息、接收分享的服务实例以及分享的数据对象。具备服务实例管理员角色（instance\_admin)或工作空间管理员角色（workspace\_admin)的用户，可以查看数据分享（share）对象的详情。

:-: ![](.topwrite/assets/image_1734493331354.png =735)

**4. 添加/删除分享的数据对象**

数据分享所属空间的空间管理员角色用户，可以添加或删除该数据分享中的数据对象（table或view）。

在数据分享列表页，点击要添加数据对象的share对象名称，进入share对象详情页面。点击“编辑”按钮，在弹窗中选择要添加或删除的数据对象。点击“确定”完成分享数据对象的更新。不可添加来源于其他share对象的数据。

添加后的数据对象会立即被share对象的消费者可见，出现在其提取数据的schema中。

:-: ![](.topwrite/assets/image_1734493367553.png =721)

**5. 配置share的分享目标**

需要对share对象配置被分享的服务实例名称（instance\_name）才可完成数据分享。服务实例名称需要数据消费端提供。

:-: ![](.topwrite/assets/image_1734493417202.png =771)

^

**6. 删除share对象**

具备服务实例管理员角色（instance\_admin)角色的用户，或该数据分享所属空间的工作空间管理员角色（workspace\_admin)的用户，可以删除数据分享对象。

在数据分享列表页或数据分享详情中，点击“操作”中的“删除”按钮，即可完成数据分享对象的删除。share对象一经删除不可恢复。数据消费端会立即失去对被分享数据的使用权限。

### 使用SQL操作

**1. 创建share对象**

为保障数据安全，share对象必须由具备“实例管理员”（instance\_admin）角色的用户创建。创建share对象时，需要在计划分享数据的工作空间中执行以下语句：

```SQL
CREATE SHARE <share_name>;
```

***

**2. 向share对象添加要分享的数据对象**

创建出的share对象初始不包含任何数据对象，需要通过 Grant 语句添加需要分享的数据对象，语法为：

```SQL
GRANT select, read metadata ON {TABLE <table_name> | VIEW <view_name>} TO SHARE <share_name>;
```

例如：

```SQL
GRANT select, read metadata ON TABLE share_demo_table TO SHARE share_demo;
```

可以使用all tables in schema 或 all views in schema方式将指定schema下当前和未来所有table或view对象添加至share中，例如：

```SQL
Grant select, read metadata on ALL tables in SCHEMA share_demo_schema TO SHARE share_demo;
Grant select, read metadata on ALL views in SCHEMA share_demo_schema TO SHARE share_demo;
```

向share对象添加要分享的数据对象时，执行操作的用户必须具备分享涉及table或view对象的select （查询）和 read metadata （查看元数据）权限，并可以进行二次授权 （with grant option）。工作空间管理员角色（workspace\_admin）天然具备上述权限。

需要取消share对象中分享的数据对象时，可通过revoke语句实现：

```SQL
REVOKE select, read metadata on {TABLE <name> | VIEW <name>} FROM SHARE <share_name>;
```

注意：当分享table或view对象时，由于table或view对象一定存在于一个schema对象下，所以该schema的元数据权限（read metadata）也会被自动添加至该share对象中。当取消share中的table或view对象时，其所属schema的元数据权限也会被自动移除。

***

**3. 配置share的分享目标**

需要对share对象配置被分享的服务实例名称（instance\_name）才可完成数据分享。服务实例名称需要数据消费端提供。

服务实例名称在Lakehouse服务中全局唯一。服务消费端用户可在首页右侧或在服务实例的URL中找到自己的服务实例名称并提供给分享者进行配置。

:-: ![](.topwrite/assets/share_img_instancename.png =786)

数据分享者配置share分享目标的语法如下:

```SQL
ALTER SHARE <share_name> [ADD | REMOVE] INSTANCE <instance_name>; 
```

其中ADD为添加，REMOVE为移出。该操作即时生效，可随时对share添加或移出分享目标实例。一个share对象可以分享给多个服务实例。

完成上述三步操作后，即完成了数据向指定服务实例的分享。

^

**4. 查询已创建share对象**

可以通过执行show命令查询已创建的share对象，语法如下：

```SQL
SHOW SHARES;
```

返回结果示例如下：

:-: ![](.topwrite/assets/share_img_showshares.png =803)

其中：

* provider为share提供者的租户名；
* provider\_instance为share提供者的服务实例名；
* provider\_workspace为share所属的工作空间；
* scope为share的分享范围，当前仅支持PRIVATE——指定instance分享；
* to\_instance为该share对象指定被分享至的服务实例名称，多个服务实例名称之间用英文逗号(,)分隔；
* kind为share的类型，OUTBOUND为当前服务实例分享出的数据，INBOUND为其他服务实例分享至当前服务服务实例的数据。

^

**5. 查询指定share分享的数据对象**

可以执行以下语句查询share中已被授予的数据对象：

```SQL
DESC SHARE <share_name>;
```

返回结果示例如下：

:-: ![](.topwrite/assets/share_img_descshare.png =798)

^

**6. 删除share对象**

可执行以下命令删除当前服务实例创建的share对象：

```SQL
DROP SHARE <share_name>;
```

share对象一经删除不可恢复。数据消费端会立即失去对被分享数据的使用权限。

## 使用被分享数据的操作

### Web端

**1.查询被分享数据**

使用具备服务实例管理员（instance\_admin）角色或工作空间管理员（workspace\_admin）角色的用户，在“数据分享”菜单的“分享给我”页签中，能够查看到所有分享给当前服务实例的数据分享对象。

点击数据分享对象名称，可以查看该数据分享的来源、接收时间以及该数据分享中当前所包含的数据（table或view）。

:-: ![](.topwrite/assets/image_1734493496334.png =777)

^

**2.提取被分享share创建schema**

在“分享给我”的列表页，或数据分享对象的详情页面，点击“提取”按钮，即可提取该分享中的数据。

:-: ![](.topwrite/assets/image_1734493713534.png =793)

提取数据时，只能以schema为单位提取，暂不支持单独提取table或view。

:-: ![](.topwrite/assets/image_1734493642759.png =541)

首先需要选择“源schema”，即需要提取该分享中哪些schema的数据。如果数据分享中包含多个schema，需要操作多次提取。

然后选择数据提取目标的工作空间，并输入存放数据的schema名称。数据提取操作将在该工作空间中新建一个schema，并存放源schema中的数据。注意，该schema被创建后为“只读”schema，不可在此schema中新建其他数据对象。

完成上述选择和输入后，点击“确定”即可完成数据提取。

**3. 使用被分享数据**

完成数据提取操作后，即可在指定创建的schema下看到share对象中该schema下分享的所有table和view对象。并可以对这些table、view对象执行select查询或与其他table、view进行join查询。

被分享数据在“数据”栏中以特殊图标标识，以便区分。

:-: ![](.topwrite/assets/image_1734493884869.png =279)

### 使用SQL操作

**1. 查询被分享数据**

数据消费方可通过show shares命令查询被分享的share对象。使用方式和返回结果与提供数据分享的第3步一致。

进一步，可通过desc shares命令，查询被分享的share中包含哪些schema和table对象。

^

**2. 使用被分享share创建schema**

通过share分享的数据，需要在消费端创建对应的schema才可查询和使用。操作语句如下：

```SQL
CREATE SCHEMA <schema_name> FROM SHARE <provider_instance>.<share_name>.<schema_name>;
```

其中\<provider\_instance>和\<share\_name>可通过show shares命令的查询结果获得；\<schema\_name>可通过desc share \<share\_name>命令指定share名称查询获得。

Create schema \<schema\_name>中的schema名称可以自行定义，不必与share中的schema名称相同。

执行上述命令时，操作者必须具备在执行操作的工作空间创建schema的权限。工作空间管理员角色（workspace\_admin）默认具备上述权限。

^

**3. 使用被分享数据**

完成create schema from share 的执行后，即可在指定创建的schema下看到share对象中该schema下分享的所有table和view对象。并可以对这些table、view对象执行select查询或与其他table、view进行join查询。

## share对象的权限

**1. 提供者权限**

仅服务实例管理员（instance\_admin）角色的用户可以创建数据共享（share）对象。执行创建

share对象的权限点如下，暂不支持使用grant 语句将share对象的权限授予其他角色或用户。

| **权限点**                                                         | **说明**                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Create share                                                    | 创建share 对象权限。                                                                 |
| Alter share                                                     | 修改share 对象，添加或删除被分享的实例ID。                                                     |
| Drop share                                                      | 删除share实例。                                                                    |
| Read metadata                                                   | show shares和 desc share权限。其中desc share可返回share 中包含的object和授予的objectPrivilege。 |
| Grant objectprivilege to shareRevoke objectprivilege from share | 为share添加或移出数据对象：Grant objectPrivilege to;Revoke objectPrivilege from。         |

^

**2. 消费者权限**

工作空间中成员均具备share对象的use和read metadata权限。但必须具备在工作空间中的create schema权限才可以使用share中分享的数据创建出schema。

| **权限点**       | **说明**                                        |
| ------------- | --------------------------------------------- |
| Use           | 使用share的权限。                                   |
| Read metadata | 查询share元数据的权限，拥有后可执行Show shares 和 desc share。 |

^
