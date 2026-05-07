# Original Prompt - 原始prompt

```
使用create-skill工具来创建skill，同时md尽量使用中文，文件名用英文，内容尽量用中文

1. 输入了几个文件，对应的是job的plan和执行统计信息，plan是指包括执行计划、dag图等，执行统计信息是runtime跑的数据量和执行时间等；
    如果job_profile.json为空，则相关处理job_profile.json逻辑可以略过；好比，增量状态表部分，有些逻辑主要是分析了plan.json，则应该可以给出这部分结果；
2. 输入的文件分别是job_profile.json是执行器跑的时间和数据量统计；plan.json则是执行计划，包括dag图，两者需要结合起来，如hashjoin，从job_profile.json不知道是hash-hash shuffle hash join还是broadcast hash join等；
3. 初始化一些主要信息，
    3.1 分类sql。从plan.json找出cz.sql.text是不是 refresh命令，如果是，则按照分类sql来找出需要优化的点；
    3.2 版本信息；plan.json可以获取版本(build_info里记录了，如，GitBranch:release-v1.2等信息），但版本不要暴露给结论，告诉你版本主要是后续会许升级到不同版本可能需要不同flag；
    3.3 vc信息；同时可以查看cz.inner.is.ap.vc是不是ap，如果为0，则不是ap模式，表示是gp模式，如果为1，则为ap模式，后续优化也会区分是ap还是GP；对于ap，则拿cz.analyze.instance.executor.count参数表示vc等core数；如果是gp，则拿cz.sql.gp.vc.capability的参数，同时除以100得到数值表示vc的core数;
    3.4 setting，plan.json记录了所有已经设置的flag，提示你如果已经有了，就不要再给建议了（不要在结论中提这些flag）
    3.5 执行计划，plan.json中的dml->stages里记录了所有dag执行的stage信息，同时对应着job_profile.json那些stage；
    3.6 统计所有operator耗时，以及在其stage的占比和整个sql占比，目的是为了后续做一些优化时，可以反复利用这些统计结果
    3.7 根据上面初始化信息得到的场景来选择后续使用的分析和优化策略
        增量计算job的分析和优化
        compaction job分析
        gpjob分析
        apjob分析
        等其他各种分类
    3.8 整体每个阶段耗时分析；job_profile.json记录了每个阶段的开始时间，这样两个阶段之间就是这个阶段的耗时
4. 增量计算refresh sql优化，即增量相关的sql优化
  增量job任务优化分两大块，一种是从运行的stage/operator算子级别优化，一种是优化状态表
  4.1 增量stage/operator级别优化
    4.1.1 增量refresh还是全量refresh;可以从plan.json找到refresh的table名字，如果plan中refresh table的tablesink算子是OVERWRITE，但是不是写delta tablesink(plan.json中是找到tablesink算子，然后在table/path对应的字段找，可能是3元组，也可能是4元组，4元组，则一般最后一个是__delta__，表示写入delta文件的tablesink)，如果不是写delta tablesink则表示是全量(即overwrite sink的不是delta，且overwrite=true则表示是全量），否则是增量，同时忽略一些中间表，目前是通过名字带有__incr__这种pattern，表示的是中间状态，则这些暂时可以忽略，即不要找错了refresh的table名字；
    4.1.2 单dop aggregate stage优化；如果stage是dop=1（可以从job_profile.json里找），如果stage里包含了Hashaggregate的Final/Complete状态（可以从相应plan.json找），并且是计算类似MULTI_RANGE_COLLECT,_DF_BF_COLLECT这些聚集函数，耗时较长，则可以给出走3阶段建议，需要设置set cz.optimizer.incremental.df.three.phase.agg.enable=true;即这个stage优化建议是设置该参数,如果已经配置了该参数，可能aggregete使用了one pass，即complete phase，则可以加上 set cz.optimizer.enable.one.pass.agg=false;来优化，同时如果还是耗时较长，没有生成3阶段，看下aggregate上的bits是多少，如果大于等于536870912，小于1073741824，则可以设置 set cz.optimizer.df.three.phase.agg.bf.width.threshold=某个值，即bits大小，因为默认该阙值是1073741824(1.3版本以及1.3以下版本是这个，1.3以上默认值是536870912)，小于这个则不会生成3阶段，如果bits小于536870912，建议不要修改该参数；如果有类似final stage还是很慢，麻烦看下它上游stage，是不是没有走aggregate的P2，这样也会导致final agg很慢，如果是同样给出再看看没有开启3阶段，以及bits是不是比1073741824小，则需要调整；请同时看是否开启3阶段以及bits大小是否符合，否则仅仅开启3阶段还是无法达到预期；额外条件，如耗时，耗时比较多
        即优化条件：
        aggregate是Final或Complete状态，且上游不是P2状态，即没有开始3阶段aggregate
        （耗时超过20s以上且占总体10%以上）或者 耗时超过30s
        stage输入数据（一般是shuffle read算子）超过20M
        dop=1
        agg有指定agg function
        如果未打开，则可以加上3阶段优化flag set cz.optimizer.incremental.df.three.phase.agg.enable=true;,如果已经有cz.optimizer.df.enable.three.phase.agg=true，则也不需要单独设置打开3阶段flag功能；
        但，如果不是3阶段需要检查bits是否满足，不满足需要额外加width threshold大小
    
        如果看到有aggregate是有MULTI_RANGE_COLLECT，但是没有_DF_BF_COLLECT或者_DF_SET_BF_COLLECT，则高优先级提示，说明bf(bloom filter)未收集对于裁剪会不佳；如果是1.3版本，则添加这些set cz.optimizer.incremental.df.three.phase.agg.enable=true;
                set cz.optimizer.df.three.phase.agg.bf.width.threshold=536870912;
                set cz.optimizer.df.bf.width.max=2147483648;
                set cz.optimizer.df.bf.width.min=1073741824;
                set cz.optimizer.incremental.enforce.creating.bf=true;
        但如果已经存在flag，则不要加；
    4.1.2 hash join优化；如果stage且耗时较长，如果stage里有join，且join占比比较多，可以看看是不是join的算法是hash-hash算法还是broadcast算法，统计信息可以从job_profile.json找，使用了什么算法，可以从plan.json找，一般来说，如果是broadcast，且shuffle量超大，则可以考虑禁止broadcast hash join，则给出优化建议是set cz.optimizer.enable.broadcast.hash.join=false;
    4.1.3 stage包含tablesink算子优化；我们stage的dop是通过累加得到，如果stage包含了tablesink算子(且不是partial sink,判断逻辑是sink算子的flags字段, flags & 0x20!=0表示partial sink；同时也不是DELTA sink，即path最后一个元素是__delta__的4元组)，但是dop与上游不太一致，如果该stage耗时比较长，dop又与上游dop差异较大，且stage耗时较长(占总体超过10%)则可能是由于会根据table的目标文件大小自动调整了dop，则给出set cz.sql.enable.dag.auto.adaptive.split.size=false;（要求是已经设置该flag为true才需要），该参数目的是不根据table的目标文件大小来自动调整dop;如果在这种场景下，stage里没有tablesink算子不要加该参数，即dop小并不是由于需要根据table目标文件大小来调整；同时建议看看每个stage的taskCount，如果其上游dop和自己相差不大，建议不要设置cz.sql.enable.dag.auto.adaptive.split.size，即下游stage一般不会超过上游dop,在不超过情况下不需要设置；
        即，优化条件
        stage包含tablesink算子（且不是partial sink，判断逻辑：flags & 0x20 != 0；也不是DELTA sink，即path最后元素是__delta__）
        stage耗时占总体10%以上
        dop与上游差异大
        dop如果与上游dop差不多（即计算依赖stage的
        task count)，则不需要额外设置cz.sql.enable.dag.auto.adaptive.split.size=false，即不需要根据此情况调整dop
        stage的dop大于上游stage的dop，则也不需要调整该参数，即下游dop都已经大于了上游，为啥还要调
    4.1.4 最大dop优化提示；我们dag这边限制了map的最大dop=4096，reduce最大dop=2048，所以碰到类似这种dop可以认为不是dop有问题，除非你有足够信服的理由，或者主动调整过这些dop，如cz.optimizer.mapper.stage.max.dop,cz.optimizer.reducer.stage.max.dop这些对应的flag;
    4.1.5 spillingBytes优化；关于spillingBytes分析，请按照算子级别来分析支持，一般有几种情况，一种是stage级别的总spill大小，还有一种是operator级别，可以相关spill stats看到有opId的，所以请根据这些级别来分析；如果是shuffle write的spill可能可以忽略；
    4.1.6 倾斜优化提示；
        1）profile里看stage的taskSummary每个task情况；如果发现只有少于5%的task有数据，则可能认为倾斜；同时需要满足stage耗时占总体超过15%才认为值得优化（避免对耗时很短的stage进行优化）；如果stage有scan算子，则看看尝试提示调整split size；set cz.mapper.file.split.size=xxx;默认是256M(268435456)，可以调小到64M等；如果有shuffleread，则可以提示关注是否有倾斜数据;
    4.1.7 从job_profile.json中taskSummary拿到每个stage的dop(可以参考4.1.3对应的代码),分析每个task跑的时间，假设给足资源(即vc core数，见3.3)情况下，整体stage需要跑多久（如，最大task时间，以及总体task数在现有资源下跑多少轮可以结束），然后再对比实际跑了多久，如果实际跑的时间是预计资源足情况的2倍以上，则给出提示；
    4.1.8 请你给出其他我未发现的问题，这里我发现你完全没理解，即不给任何分析，这里可以对所有stage看看时间耗时，对于那些比较慢的，可以主动分析为什么慢，如operator慢？还是其他等原因，希望你可以更smark点
  4.2 状态表优化
    4.2.0 如果给的prompt中没有提到使用状态优化，则不需要来使用下面优化原则来优化
    重要：关于状态表这些优化必须是对应算子的对应增量算法，如aggregate则必须是增量算法产生的，join/window等都类似；可以根据4.2.1.2来判断；即只有包含增量hint的算子才需要进行状态表优化分析，没有增量hint的算子应该跳过；
    4.2.1 看看当前的job是否是增量刷新的job，即4.1.1提到的如何判断是增量还是全量，以及增量计算的整体plan分析
        4.2.1.1 识别所有operator(算子)是delta还是snapshot；如果是增量plan，由于是增量计算的plan，可以收集哪些表是是增量数据，哪些是读snapshot其中，对于tablescan算子，incrementalTableProperty有from/to分别记录了版本是从哪个版本到哪个版本，如果 from=28800，to=57000，则表示delta，如果from=-9223372036854775808，且to=28800表示表读数据的上个状态，或from=-9223372036854775808,to=57600，表示是当前状态，即(from=-9223372036854775808,to=28800，即上个状态或者说上个snapshot) + (from=28800, to=57600,即delta数据) = (-9223372036854775808=-9223372036854775808,to=57600，当前状态或者当前snapshot)
        ，即 只有在from=28800且to=57600情况下表示tablescan的数据是delta,如
        incrementalTableProperty": {
            "from": "28800",
            "to": "57600",
            "fromMetaVersion": "0",
            "toMetaVersion": "0"
        }，该json例子表示是delta，其他都是snapshot，snapshot有一个明显特征是from=-9223372036854775808
        注意：只有包含incrementalTableProperty的tablescan才需要分析，没有该属性的tablescan（如delta元数据扫描）应该跳过；
        同时，需要区分业务数据扫描和元数据扫描：如果schema包含file_path, pos, commit_ts, operation, field_id, value等字段，则是delta元数据扫描，不是业务数据，应该跳过分析；
        这样就方便分析增量算法，对于join/aggregate/window增量算法你自己根据相关知识找到算法逻辑，从而推导出增量plan的形态,如delta(join)算法=delta(Left) join delta(right)，即计算出left和right的delta数据就可以得到join的delta，也可以认为是重算rule，类似对于aggregate/window也是类似，下面的一些分析请区分出哪个是真正的join/aggregate/window的增量算子再添加状态，有些aggregate是算法的一部分，而不是对应原始sql里的aggregate，请注意区分，同时window/join也是类似
        一般一元算子，如果输入是delta，则自己输出也是delta，输入是snapshot，则自己输出也是snapshot;
        如果是join，只有left和right都是snapshot，join结果才是snapshot；
        对于union多元算子，如果输入都是snapshot，则union输出也是snapshot，如果全部输入是delta，则union输出也是delta，如果部分delta，部分snapshot，应该也是snapshot，但这种plan一般不太会出现，也可以列出来，看看是不是你脚本处理问题；
        其他多元算子，可以展示出来，可能遗漏了，一般也可以按照union规则处理；

        ⚠️ 重要补充：增量算法Hint优先规则
        - 如果算子有增量算法hint（如IncrementalJoinRule, IncrementalAggregateRule等），该算子应该被标记为delta
        - 这是因为增量算法是用来处理增量数据的，即使输入是snapshot，增量算法也会输出delta
        - 增量算法的语义：可以接受SNAPSHOT输入并产生DELTA输出（通过比较两个snapshot计算差异）
        - 检查方法：在算子的JSON中查找"Incremental"或"DeltaState"关键字
        - 优先级：增量hint检查应该在基于输入的传播规则之前执行
        - 实际案例：HashJoin有IncrementalJoinWithoutCondenseRule hint，即使一个输入是SNAPSHOT，另一个是DELTA，该HashJoin仍应标记为DELTA

        同时在plan.json里找到所有operator对应的Id，注意这里的ID不是代码中那些index下标，即使用 plan.json 中的实际 operator ID，而不是数组索引；注意这里一个算子可能有多个下游
        注：这里依赖关系不要和stage挂勾，代码如果有请修正；
        4.2.1.2 识别不同算子的增量算法；4.2.1.1已经知道了所有增量算子的依赖关系，你就能自动识别增量算法，可以把所有算子operator的delta/snapshot依赖关系整理串联起来；可以得到所有算子是计算delta还是snapshot，同时有些算子会有hint记录类似Rule:xxx这种pattern，如，Rule:IncrementalLinearFunctionAggregateRule，这个增量rule表示是计算aggregate的一种增量算法（即，rule名字包含了Aggregate，其他规则类似），如果这种hint不是在Aggregate(如，在join上)上，则说明这些算子是为了计算Aggregate增量算法的一部分；其他类似join/window增量算法也可以类似处理，有些hint计算的Rule有一些算子Id，如果一个Id出现在不同地方，说明这些整体都是来计算同一个算子的增量算法，如Rule:IncrementalJoinWithoutCondenseRule_cz::optimizer::LogicalJoin#31766417，这里的LogicalJoin#31766417表示为了计算该join算法而加的hint，这样所有相同都是为了计算同一个join，即属于Join算法的一部分；有些增量算法会打上其他hint，类似HINT=delta,DeltaState:[1,1896] - [1,6393]_IncrementalWindowSetDeltaRule#cz::optimizer::Window#293342，其中第一部分delta表示计算delta，即增量算法都是计算delta数据来优化，DeltaState表示该算子是整体增量算法的状态算子，IncrementalWindowSetDeltaRule表示是使用的算法，Window#293342则表示是对哪个算子计算了增量算法，如果没有这些类似Id，则可能是没有加上id来标识，不要误把没有加的hint当作是认为计算同一个算子；然后这样找出每次计算一个算子增量算法的边界其实可以区分出来；
        如aggregate，如果是重算算法，则可能是根据([输入是delta] join [输入的snapshot])得到变动的aggregate输入，然后再计算aggregate就可以得到aggregate增量算法，所以这里aggregate增量算法就用到了join算子等；
        4.2.1.3 算子增量算法对应的subplan，如包含哪些算子，算子对应的root阶段是什么；上面一步一步得到了每个算子的delta/snapshot，以及他们之间的依赖关系，这些都是可以认为是operator之间关系，忽略stage之间关系；通过上面hint以及operator之间的依赖关系，这样就可以知道这一些长串的算子对应了某个算子的增量算法，把这些进行归类，需要把一个增量算法对应的所有算子都找到，这里对应的plan.json的"id"字段表示每个算子的唯一id；
        根据4.2.1.2找到相同增量算法的算子，对于一些没有找到id的rule hint应该往自己下游继续查找，找到第一个带有id且同类（是指是相同算子，如，都是agg/window/join等）的增量算法，这些算子联通(遍历)起来的算子一定属于该算法的subplan一部分（即，类似有N个点组成的一个图，点中间的所有算子肯定属于该增量算法），然后按照下面规则遍历“这些一定属于该算法的算子”的上下游算子来剩下的其他算子属于该增量算法，直到边界算子结束;
        这里的算子增量算法对应的subplan不是让你把rule相同的合在一起，rule相同的算子肯定来源于同一个算子对应的增量算法，而是让你把某一个增量算法涉及到的所有算子都包含起来，这些算子不一定有Rule这些hint，即他们是一个执行的subplan，而不是这些零散的hint operator组成，即subplan 应该包含整个执行路径的所有算子，而不仅仅是有 Rule hint 的算子;

        关于DeletePlan的处理：
        - DeletePlan相关hint用于表示删数据的plan，不属于任何增量算法
        - 在解析Rule hints时，应该忽略（过滤）所有DeletePlan相关hint，不作为增量算法的起点
        - 在遍历查找subplan时，如果遇到DeletePlan相关算子，必须作为边界条件终止遍历
        - 为什么必须终止而不是跳过：因为plan是执行路径，如果跳过DeletePlan继续查找，找到的subplan会缺少中间算子（不完整），这样的subplan不能算是增量算法的一部分

        每个增量算法包含哪些operators，需要设置边界条件：
        (1)碰到不是相同hint要终止，避免跨越算法边界，需要添加到subplan里；
        (2)aggregate增量算法在查找自己涉及哪些算子时，上游碰到了final/complete状态也要终止，即表示在自己算delta，那已经结束了，需要添加到subplan里；
        (3)碰到deleteplan相关算子必须终止，因为它不属于任何增量算法，且plan是执行路径不能跳过，不需要添加到subplan里；
        (4)对于snapshot的算子，必须终止，因为snapshot表示snapshot状态，用来构造增量算法的输入节点，不需要把计算snapshot的整个过程都添加到增量算法的operators中，但snapshot算子本身属于增量算法一部分，需要添加到subplan里；
        (5)如果是calc有hint，且hint包含了DeltaState和Incremental这些也需要终止，避免跨越算法边界；如，类似DeltaState:[1,14] - [1,43]_IncrementalJoinWithoutCondenseRule#cz::optimizer::LogicalJoin#973；注意：这种calc算子虽然要终止遍历，但在bottom-up遍历时应该将该算子包含到对应增量算法的算子中，即包含该算子但不继续向上游或下游遍历，需要添加到subplan里；
        (6)增量算法查找算子时，如果碰到aggregate，且aggregate的聚集函数包括MULTI_RANGE_COLLECT或者_DF_BF_COLLECT，则终止，不需要添加到subplan里，因为这个是一个df的aggregate，仅仅是优化的一个plan，不需要添加；

        验证规则（这些是规则不是告警，如果不满足，说明脚本有问题，请修改）：
        - 同一个operator不应该属于两个不同的增量算法，或者只有增量算法的对应root节点或者tablescan才能横跨多个增量算法
        - 如果一个算子又不是增量算法的root节点，又属于多个增量算法，则应该有问题
        - 由于计算算子的delta/snapshot是从上游operator到下游operator经过propogate，所以如果某个operator属于了上游的增量算法，就不应该属于下游
        - 从找到的root节点开始top-down遍历所有算子，在碰到了非边界算子前是不是有其他增量算法的算子，如果有，说明脚本有问题；同时保证自己的所有operator一定能遍历到，如果还有没遍历的算子，说明脚本有问题，请修改；
            4.2.1.3.1 Aggregate算子的增量算法，如果发现有hint，则可能需要往依赖的下游算子继续查找，找到是Final/Complete状态的Aggregate算子才算结束，甚至有些Aggregate增量算法可能是由多路union得到，则这样还需要把union下游算子找到Aggregate的Final/Complete算子，即union 两边可能包含了相同的hint，则需要这些输入相交合并后继续查找得到他们的subplan，这些执行路径的算子也属于Aggregate；其他算子的增量算法应该也需要这样查找，即对于相同hint（表示同一个算子对应的增量算法，注意有些没有Id来唯一标识，这个时候别搞错了）如果不是同一个分支执行路径算子，需要合并起来得到；
        每个增量算法得到了自己所有算子后，把所有tablescan算子找出来，如果所有的delta类型的scan全部是appendonly的tablescan，则显示出来，并标注；如果不全部是，也请显示每个tablescan是不是appendonly；appendonly信息在4.2.1.5里已经得到，从这里拿；
        4.2.1.4 展示增量算法以及显示查看增量算法的状态信息/状态图等；把整体增量算法是计算哪些算子的依赖关系画出来，好比，这一堆算子是计算aggregate，这一堆算子是计算join等等，同时画出他们的依赖关系，这样就知道先计算aggregate再计算join，还是先计算join再计算aggregate等; 同时可以让prompt方式可以查看到增量算法图或者状态图，如哪些算子组成了aggregate算法，哪些算子组成了join等等(即脚本里应该可以直接分析查看，如传递参数等)；
        4.2.1.5 算子delta是appendonly(纯增delta)还是有删除的delta;在4.2.1.1已经计算了算子是delta还是snapshot，现在需要区分delta是纯增还是有减（有删除的行），因为在纯增场景对于aggregate/window可以用一些更优的算法；
        scan如果是delta，则看是不是输出__incremental_deleted列（注意是过去式deleted，不是delete）。检查方法：从算子的实际输出列（operator.schema.structTypeInfo.fields）查找是否输出该列，而不是从表定义的完整schema（tableSchema）查找。如果输出__incremental_deleted列，则表示delta不是纯增；如果没有输出，则表示delta是纯增；
        join算子，则看所有的input是不是delta，如果只有一路是delta，且join type是inner/anti/left semi，则继承该输入的delta是不是纯增；如果所有输入input都是delta，所有delta都是纯增，且join上有类似HINT=Rule:这种pattern，且join type是inner/left_semi/anti时，则join的delta也是纯增，否则认为是非纯增；
        aggregate/window算子继承输入的delta是否纯增。增量算法标记（4.2.1.2）只表示使用了增量算法，不影响append-only判断；append-only完全取决于输入数据（TableScan是否输出__incremental_deleted列）；
        其他算子都是把所有输入的delta一起看，只要有一路不是纯增，则表示该算子delta都不是纯增的；
        还有一些规则，如，window，类似这种HINT=delta,DeltaState-:[1,1896] - [1,6393]_IncrementalWindowSetDeltaRule#cz::optimizer::Window#44的pattern，DeltaState-中的-表示有删除，DeltaState+中的+表示是纯增，所有aggregate/join都有类似pattern；
    4.2.2 提示非增量原因；如果job非增量刷新，且版本小于等于1.3，则请设置这些flag（
        set cz.optimizer.print.non.incremental.reason=true;
        set cz.optimizer.print.non.incremental.reason.msg.max.length=100000;
        set cz.optimizer.incremental.force.incremental=true;
        ），加上这些flag后，会提醒用户没有增量的原因；如果是1.4以及以上版本，则如果加上cz.optimizer.incremental.try.incremental.refresh.enabled=true,会提示为什么没有走增量；
    下面优化策略都是基于plan是增量plan而需要查看的，所有算子之间的依赖关系理论上4.2.1已经构建好了，下面规则应该复用这些已经构建好的依赖关系；
    同时关于状态表这些优化必须是对应算子的对应增量算法，如aggregate则必须是增量算法产生的，join/window等都类似；可以根据4.2.1.2来判断；
    4.2.3 window算子在输入delta是appendonly(即纯增的增量，没有删除delta)优化；
        window算子的父节点是calc，且存在 row number=1的pattern（表示的是window的rownumber函数输出后，在calc里面有这个列=1的pattern），请看看window的输入是否是append-only的delta（即，4.2.1.5）。注意：判断window输入是否append-only应该使用4.2.1.5中IncrementalAlgorithmAnalyzer分析的全局结果（operator_append_only_types），该结果包含了跨stage的所有算子的append-only信息，而不是在当前stage内搜索TableScan（因为TableScan可能在不同stage）。如果是append-only且rn=1的pattern，但是window没有使用IncrementalLinearTopKWindowRule增量算法（注意：支持V1和V2版本，即IncrementalLinearTopKWindowRule或IncrementalLinearTopKWindowRuleV2），则请设置以下flag继续尝试cz.optimizer.incremental.window.sd.to.sd.rule.enable=false; 如果是append-only的delta输入，则一直检查到tablescan，查看tablescan的table属性是否有property：incr.append.only.table=true 或者 job是否flag具备 cz.optimizer.incremental.append.only.tables='xxx'，如果没有这些flag或者properties请提醒用户需要在该表添加上incr.append.only.table=true属性（注意：incr.append.only.table属性仅用于提醒用户设置，不影响append-only的判断逻辑）；
        rn=1 pattern如何查找可以类似参考{"function":{"from":"","name":"EQ","builtIn":true,"arguments":[{"reference":{"id":"0","local":false,"from":"","name":"","refType":"LOGICAL_FIELD"},"typeReference":1},{"constant":{"bigint":"1"},"typeReference":1}],"properties":{"properties":[]},"execDesc":"EQ(i64,i64)->b","functionProperties":{"properties":[]}},"pt":{"start":{"line":1,"col":7356,"pos":7355},"end":{"line":1,"col":7364,"pos":7363}},"typeReference":13}
        这里的EQ表示等于(=)，constant有个值bigint:1，表示是1，所以对应的其实就是xx=1
    4.2.4 基于我教给你的4.2.3的方法，看看当前query中是否还包含append-only的scan，如果包含，根据你的经验预判一下当前是否使用的算法并非最优的
        核心思想：如果系统中仍然存在对append-only数据的扫描，说明可能没有充分利用append-only特性进行优化。理想情况下，append-only数据应该通过增量算法处理，而不是重复扫描。
        检查逻辑：
        1. 根据4.2.1.1规则，只分析有incrementalTableProperty且from != -9223372036854775808的delta业务数据扫描
        2. 排除delta元数据扫描（schema包含file_path, pos, commit_ts, operation, field_id, value等字段）
        3. 排除中间状态表（表名包含__incr__, __state__, __temp__等pattern）
        4. 对于真正的append-only业务数据扫描，分析为什么还在扫描而不是使用增量算法：
           - 检查是否可以使用状态表避免重复扫描
           - 检查是否已使用增量算法（通过hint检测）
           - 综合评估append-only数据特性是否被充分利用
    4.2.5 是否有创建中间状态表；即看整个job的所有stage中tablesink是不是有表名包含__incr__；如果不包含，可以设置cz.optimizer.incremental.enable.state.table=true;来开启中间状态优化。但是在开启之前，我希望你根据经验判断一下当前是否值得存储中间状态，你可以从以下几个方面进行判断：1.是否需要状态（可以参考流计算的带状态计算的定义），但必须是增量算法产生的算子（根据4.2.1.2的hint判断），2.状态表是否过大（请根据当前看到的每一步的stats信息和输入表的增量数据大小进行合理判断）；
        对于有有状态算子，需要区分增量算法是不是对应的增量算法，如，join算子对应的rule是join，aggregate类似，除非是第一次出现hint的operator，否则应该都有对应关系，不要错误把一些增量算法的中间算子当作自己本身
        注意：状态表检查应该是job级别的，不仅仅检查当前stage，需要检查整个job的所有stage是否已包含中间状态表，避免误判；
        基于算子是增量算法来创建中间状态表优化的逻辑，在未提示情况下默认不开启；
        找算子是snapshot（即类似全量计算这个subplan）占比比较高的(如，15%以上等)，一般这种需要创建中间表状态表；这里的operator是snapshot是指整个路径上所有的snapshot的耗时在整体的占比，因为如果中间表物化后就可以减少这部分计算；同时打印出该snapshot的“骨架”，即把重要算子打印出来，如aggregate/join/window/tablescan，aggregate打印出聚集函数，window类似，这样方便从原始sql找到对应的sql，这样join等就知道是从哪个tablescan开始到哪里结束需要创建中间表；
    4.2.6 aggregate linear rule优化；该aggregate必须设置上了hint包含类似4.2.1.2的一些状态hint，如果不包含，说明该aggregate算子不是原始sql中的aggregate，而是其他优化器rule等自己生成的，这些不需要检查；然后看看当前任务中aggregate的计算是否利用上了之前的计算结果（对于SUM，COUNT希望无论如何都尽量使用之前的结果，对于MIN，MAX希望在append-only的情况下尽量使用之前的结果），如果发现没用上，请根据4.2.5我教会你的方法看看是否存在状态，如果状态存在，请根据4.2.1.5教会你的方法看看是否有append-only的输入，如果是append-only但是缺少系统hint的，请补充上hint
    4.2.7 占比时间长calc可以存状态，如，calc占整体stage超过30%，同时整个stage在整体耗时占比15%以上,如果发现这类calc，可以看calc是不是有比较占比高的function计算，特别是udf(即用户自定义function)则可以通过set cz.optimizer.incremental.create.rule.based.table.on.heavy.calc=true;进行优化
        额外条件：
        - calc必须是snapshot状态（不是delta），如何获取见4.2.1.1规则，从operator_data_types中获取
        - 输出信息应包含：calc耗时、calc占stage比例、stage耗时、stage占整体比例，类似4.1.6倾斜规则的详细输出
    总体所有满足这些优化pattern的，请可以显示出来，提供查看

5. compaction优化，TODO
6. gp job任务优化，TODO
7. ap job任务优化，TODO
8. job报错分析
    8.0 统一从job_profile.json的message里收集所有错误信息，可能会有重复报错信息，记得精炼错误信息，以便提供下面错误分析优化以及给出建议；且job_profile.json中有"hint"记录了设置过哪些flag，如果下面建议提示设置什么flag，请检查是否存在，如果不存在才提示加flag；
    8.1 提交冲突报错；从job_profile.json中找message里有如“this job has conflicts with another concurrent job which updates”，解决方法提示只要重跑整个job；
    8.2 优化器报错；
        8.2.1 提示生成playback信息；message里如果包含类似“Optimizer internal error”这种错误，则提示设置cz.sql.playback.scratch=true，重新跑报错job，这样会有playback信息，提供优化器定位问题；
        如果已经设置了cz.sql.playback.scratch=true，则不需要提示添加flag，而是提示已经有了信息可以找技术支持；
        8.2.2 TODO（针对不同错误信息可能有不同策略，暂时未实现）
9. 不要给没有提示的参数，即有些你给的flag是凭空说的;只在发现实际问题时才建议参数；其他的请单独列出，但是不要给什么强烈建议这种重跑，交给用户自己决定；
10. 可以将脚本按照不同sql分类来进行拆开，后续便于管理，即要考虑后续skill如何迭代；构建脚本尽量以不同场景来构建，方便扩展，如增量是一类，compaciton是一类等等;
   脚本命名不要和数字结合，容易导致prompt变了，但脚本数字和prompt对应不上问题
11. 脚本和md里不要出现v3，规则3这种带有版本或者数字第几章的东西，后续无法维护
12. 脚本生成原则，优化规则里尽量用logger来打印，除一些整体的步骤等打印可以使用print
```