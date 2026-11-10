# 两个原生循环的设计依据

这是 cz-cli 的设计取舍，不声称复刻其他项目的全部运行方式。

- [Anthropic：Building effective agents](https://www.anthropic.com/research/building-effective-agents)：优先简单可组合的流程，有必要才增加编排。这里将两个反馈渠道交给一个会话，复用已有采集、任务和回执，不新建调度框架。
- [Anthropic：Effective harnesses for long-running agents](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents)：逐项推进、保留可验证进度和清晰交接。这里保留来源队列、独占 worktree、最终 SHA 审查、真实验证及外部回执。
- [Claude Code 原生调度](https://code.claude.com/docs/en/scheduled-tasks)：定时提示词与事件接入职责不同，调度依赖运行中的会话并有版本相关的恢复和到期行为。这里使用原生五分钟补扫和十二小时反思，Monitor 负责飞书事件；恢复时实际核对任务和监听，不以进程存在代替验收。

- [Geoffrey Huntley：Ralph](https://ghuntley.com/ralph/)：根据观察到的实际失败持续修正提示词；这里只借鉴这一反馈方式，反思记录已发生的误解与重复故障，不照搬其单任务串行模式。
- [Cursor：Scaling long-running autonomous coding](https://cursor.com/blog/scaling-agents)：区分协调、实施和评估职责，并通过移除多余角色减少瓶颈。这里由反馈会话协调、后台子 Agent 实施、独立子 Agent 审查，不引入其大规模编排。

事件先定向读取，完整补扫后台进行；主反馈会话在长实施期间仍负责接收和回应。反思只整理易误解点、人工待决和重复故障；独立审查和随修复更新的必要文档仍随任务进行。

运行验收用真实任务、来源读取和发送回执。用户已要求不发送飞书测试消息，事件到回复的验收等待自然到达的真实问题。
