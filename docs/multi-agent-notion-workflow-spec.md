# 多 Agent 同步到 Notion 的工作流（可执行规格）

本规格将 Notion 定义为「统一 Review 面板」，同时把“机器可执行的真相”从页面正文迁移到数据库（Database）中，以避免多 agent 并行写入时互相覆盖、丢进展、丢决策。

本地文件是权威基线；Notion 作为共享镜像与 Review UI，需要与本地保持一致。

快速理解：

- 机器可执行信号写入数据库：Milestones / Decision Requests / Commands / (Memory Proposals)
- 每次任务先显式产出 `Why / Context / What` 简报；共享 Memory 与 guardrails 隐式继承
- 企业 IM 中已授权的 OpenClaw 是唯一的人机交互入口：接任务、红灯决策、结构化交互、状态回写
- 绿灯 / 黄灯默认静默，只写 Notion；只有红灯才主动 push
- 页面只承载“1 屏摘要 + 菜单索引 + 嵌入视图”，避免大段正文与覆盖
- 里程碑用“摘要字段 + 子页面细节 + 历史压缩”做渐进式披露

---

## 1. 目标与非目标

### 目标

- Memory 持久化：稳定偏好与关键决策一次沉淀，跨所有 agent 共享。
- 全自动执行：每次任务先生成最小任务简报 `Why / Context / What`，其余执行细节默认自治。
- 决策信号：agent 内置绿 / 黄 / 红判断，默认静默推进，只有红灯才立即打断。
- 闭环收口：所有产出收口到统一 Review 面板；用户拍板后，agent 直接领任务继续执行，人不做中转。
- 可并发写：多 agent 并行写入不互相覆盖，且可追踪、可去重、可回溯。
- 渐进式披露：项目进展可快速扫描（1 屏摘要），可下钻细节，且历史可压缩。

### 非目标（MVP 不做）

- 不再单独维护新的告警机器人或平台专属 webhook 作为正式主链路；正式入口统一为企业 IM 中已授权的 OpenClaw。
- 不把 Notion 页面正文当作单一真相总线（数据库为真，页面为叙事）。

---

## 2. 核心原则（必须遵守）

- **Database First**：所有“可执行信号”必须写入数据库行，不写入页面大段正文。
- **页面只写摘要**：Dashboard 页面只保留一屏内摘要 + 嵌入数据库视图，禁止整页重写。
- **幂等与认领**：任何会触发执行的对象必须有 `idempotency_key`；任何任务必须先 `claim` 后执行。
- **显式任务简报**：每次新任务先产出 `Why / Context / What`；共享 Memory、工程审美、通知规则与 guardrails 隐式继承，不重复灌入长指令。
- **Green Default**：默认按绿灯处理，直接做；若命中黄灯则静默挂起并继续做别的；只有红灯才立刻打断。
- **Silent First**：绿灯和黄灯默认只写 Notion，不主动刷企业 IM；红灯才主动 push。
- **不可逆门禁**：即使不是红灯，agent 也不得越过“不可逆步骤”的执行点。
- **渐进式披露**：新里程碑默认短摘要；细节写在该里程碑行的子页面中；旧里程碑可被压缩。
- **Single Human Entry**：企业 IM 中已授权的 OpenClaw 是唯一正式交互入口；Notion 是统一 Review 面板，不承担主命令入口职责。

---

## 3. Notion 工程空间信息架构

### 3.1 两类对象

1. System of Record（机器真相）：Notion Databases
2. Human Surface（人读界面）：Notion Pages（Dashboard/叙事/说明）

### 3.2 必备数据库（最小集合）

以下数据库是 MVP 必需。建议统一放在一个“工程空间根页面”下，便于权限与视图管理。

#### A. Projects（项目表）

- `project_id`（title）：`PRJ-xxx` + 项目名
- `status`（select）：active / paused / done
- `root_page_url`（url）：项目 Dashboard 页
- `review_window_note`（rich_text）：你的 review 节奏备注（可选）
- `display_tags`（multi_select，可选）：面向人读的展示标签
- `retrieval_tags`（multi_select，可选）：面向检索/RAG 的稳定标签（不要写成长句）

#### B. Milestones（里程碑表）

- `milestone_id`（title）：`M-YYYYMMDD-xxx` + 名称
- `project`（relation -> Projects）
- `phase`（select）：align / execute / review
- `status`（select）：planned / in_progress / ready_for_review / accepted / rejected / archived
- `contract_status`（select，可选但 execute 前必填）：draft / approved / superseded / n_a
- `contract_url`（url，可选但 execute 前必填）：任务简报页面或锚点链接
- `approved_by`（rich_text，可选）：谁拍板了任务简报
- `approved_at`（date，可选）：何时拍板
- `summary`（rich_text）：强制 1 屏内摘要（上限建议 600 字）
- `acceptance_result`（select）：pass / fail / partial / n_a
- `artifacts`（files 或 url）：报告、截图、demo、commit、PR 链接
- `written_by`（rich_text）：agent 名
- `idempotency_key`（rich_text）：必填
- `compression_level`（select，可选）：L0_full / L1_summary / L2_tldr
- `display_tags`（multi_select，可选）
- `retrieval_tags`（multi_select，可选）
- `last_updated`（last_edited_time）：自动

约束：

- 每个里程碑详情写在该行打开后的子页面中（正文），而不是写回 Dashboard。
- 里程碑子页面建议固定结构：进展、风险、待决策、下一步、验收结论、证据链接。

#### C. Decision Requests（决策请求表）

- `decision_id`（title）：`DR-YYYYMMDD-xxx`
- `project`（relation -> Projects）
- `signal_level`（select）：green / yellow / red
- `status`（select）：proposed / needs_review / approved / rejected / superseded
- `question`（rich_text）：决策点一句话
- `options`（rich_text）：2-3 选项（可含对比要点）
- `recommendation`（rich_text）：推荐 + 理由
- `why_now`（rich_text，可选）：为什么现在需要记录或升级
- `escalate_after`（date，可选）：黄灯在什么时间后自动升红
- `impact_scope`（select）：module / cross_module / data / security / deploy
- `irreversible`（checkbox）
- `downstream_contamination`（checkbox）
- `owner_agent`（rich_text）
- `idempotency_key`（rich_text）：必填
- `source_url`（url）：可选，指向产生该决策的上下文（PR/文档/讨论）
- `display_tags`（multi_select，可选）
- `retrieval_tags`（multi_select，可选）

#### D. Commands（指令队列表）

这是“用户输入 -> agent 执行”的规范化入口。企业 IM 中的 OpenClaw 消息、结构化交互、快捷动作、Notion 评论都要先被适配成该表行。
保留单表，不拆成多张来源表；来源差异通过 `source`、`idempotency_key` 命名空间和来源专属字段隔离。

- `command_id`（title）：`CMD-YYYYMMDD-xxx`
- `project`（relation -> Projects）
- `channel`（select）：enterprise_im / notion / manual
- `target_type`（select）：milestone / decision / memory / other
- `target_id`（rich_text）：例如 `M-...` / `DR-...`
- `parsed_action`（select）：continue / improve / retry / stop / clarify
- `instruction`（rich_text）：指令正文
- `context_quote`（rich_text，可选）：评论锚点附近的引用文本/上下文片段（便于 agent 精准改动）
- `anchor_block_id`（rich_text，可选）：Notion block id（如果命令源自评论线程）
- `channel_session_id`（rich_text，可选）：企业 IM 会话 ID
- `channel_message_id`（rich_text，可选）：企业 IM 消息 ID
- `operator_id`（rich_text，可选）：企业 IM 中的操作者 ID
- `event_key`（rich_text，可选）：结构化动作或菜单事件 key
- `status`（select）：new / claimed / executing / done / failed / ignored
- `claimed_by`（rich_text）
- `ack`（rich_text）：`ack:CMD-...`
- `source`（select）：openclaw_im_message / openclaw_im_action / openclaw_im_shortcut / notion_comment / manual_row
- `source_url`（url）：评论 thread、企业 IM 消息链接或页面链接
- `idempotency_key`（rich_text）：必填
- `last_updated`（last_edited_time）：自动

#### E. Memory Proposals（可选但强烈建议）

把“稳定 memory”写入改为两段式，避免多 agent 直接改稳定区造成冲突噪声。

- `proposal_id`（title）：`MP-YYYYMMDD-xxx`
- `category`（select）：collaboration / engineering / evaluation / decision
- `scope`（select）：global / project / module / retrieval / reco / infra
- `proposal`（rich_text）：候选规则/偏好（短句）
- `rationale`（rich_text）：为什么值得沉淀（短）
- `source_url`（url）：证据链接（可选）
- `owner_agent`（rich_text）
- `status`（select）：new / triaged / needs_review / merged / rejected
- `conflict_note`（rich_text）：冲突说明（可选）
- `idempotency_key`（rich_text）：必填

#### F. Memory Audit（P1 起必需）

用于记录 Memory Curator 的每次 merge / reject / rollback / manual override，防止 Curator 成为不可审计的单点。

- `audit_id`（title）：`MA-YYYYMMDD-xxx`
- `project`（relation -> Projects，可选）
- `scope`（select）：global / project / module / retrieval / reco / infra
- `action`（select）：merge / reject / rollback / manual_override
- `before_ref`（url 或 files）：合并前基线快照 / 页面链接 / 本地 diff 产物
- `after_ref`（url 或 files）：合并后基线快照 / 页面链接 / 本地 diff 产物
- `diff_summary`（rich_text）：本次变更摘要（必须可快速扫描）
- `source_proposals`（relation -> Memory Proposals，可选）
- `operator`（rich_text）：memory_curator / human:<id>
- `review_status`（select）：logged / needs_review / confirmed
- `rollback_of`（relation -> Memory Audit，可选）：若本条是回滚，指向被回滚记录
- `idempotency_key`（rich_text）：必填

---

### 3.3 可选数据库（规模变大时启用）

#### G. Roadmap Items / Epics（路线图条目表，可选）

当一个项目的里程碑数量变多，建议引入 Roadmap Items 作为“稳定菜单目录”，让里程碑只承载增量进展。

- `roadmap_item_id`（title）：`R-xxx` + 名称
- `project`（relation -> Projects）
- `status`（select）：planned / in_progress / done / parked
- `success_metric`（rich_text，可选）：该条目最终怎么算完成
- `milestones`（relation -> Milestones）：关联该条目下的增量里程碑
- `display_tags` / `retrieval_tags`（可选）

---

### 3.4 企业 IM 中的 OpenClaw（统一交互入口）

正式方案收敛为“企业 IM 中已授权的 OpenClaw + Notion Review 面板 + Agent Router”，不再额外引入新的主动告警机器人作为主链路。

职责边界：

- OpenClaw 企业 IM 入口：接收用户消息、结构化动作、快捷操作，承载红灯决策与任务分发
- Agent Router：把企业 IM 输入解析为 `Commands` / `Decision Requests`
- Notion：沉淀进度、决策、验收与 Memory，不承担第一命令入口

最小能力要求：

- 已在企业 IM 中完成授权，且具备稳定收发消息能力
- 能接收用户消息并交给 OpenClaw
- 能主动向用户发送消息，或在指定会话中稳定触达用户
- 若平台支持结构化卡片 / 按钮 / 菜单，则优先接入；若不支持，则退化为约定文本命令

交互原则：

- 用户要“给任务、拍板、继续执行”，优先在企业 IM 中的 OpenClaw 对话里完成
- 用户要“集中 review、看历史、查依据”，优先在 Notion 里完成

---

## 4. Dashboard 页面规范（渐进式披露）

每个项目一个 Dashboard 页（Human Surface），固定结构如下：

### 4.1 Now（1 屏摘要区）

只写 4 类信息，且每类最多 3 条：

- 当前里程碑（milestone_id + 1 句摘要）
- 红灯事项（需要立即处理的决策或异常）
- 黄灯事项（已挂起、等 review 的阻塞点）
- 最近静默完成（绿灯结果 + 下一步）

约束：

- agent 只允许更新这一小段摘要（且必须是“替换该段”，不重写整页）。
- “1 屏”约束只适用于 Now 摘要区；Menu / Queues / History 可以展开浏览、滚动查看，不要求整页永远停留在 1 屏内。

### 4.2 Menu（里程碑目录）

嵌入 Milestones 的视图，默认按时间倒序显示：

- milestone_id
- status
- summary（短）
- acceptance_result
- last_updated

这就是可下钻索引目录。点击行即可进入里程碑子页面看细节。

补充（推荐）：

- 当引入 `Roadmap Items / Epics` 时：Dashboard 增加一个“Roadmap Menu”视图（按 roadmap 条目分组），每个条目下挂载相关 Milestones，形成“稳定菜单 + 增量更新”的结构。

### 4.3 Queues（队列区）

嵌入三个视图：

- Decision Requests · Red（signal_level=red 且 status=needs_review）
- Decision Requests · Yellow（signal_level=yellow 且 status in (proposed, needs_review)）
- Commands（status=new/claimed/executing）

### 4.4 History（历史区）

History 不在 Dashboard 页 append 长文；全部通过数据库过滤查看。

压缩策略：

- 当里程碑状态为 `archived` 或距离当前超过阈值（例如 30 天），允许压缩其子页面正文。
- 压缩后仍必须保留：结论、关键证据链接、关联决策 ID。

### 4.5 里程碑子页面模板（强制渐进式披露）

里程碑子页面正文必须采用“先摘要后细节”的结构，第一屏只允许出现 TL;DR 与结论，不要把长过程铺在顶部。

推荐模板：

- `TL;DR`：3-7 条 bullet，必须能在 30 秒内读完
- `结论 / 现状`：通过/部分通过/失败的判断 + 一句话原因
- `证据`：artifact 链接（demo、截图、评测报告、PR）
- `风险举手`：只写“会影响交付/质量的风险”，其余放到细节
- `待决策`：列出关联 `DR-...` 的链接
- `下一步`：3-5 条可执行动作（如需你拍板则转 DR 或 CMD）
- `附录（可折叠）`：过程日志、长讨论、备选方案细节

约束：

- 每次里程碑更新都必须更新 Milestones 表行的 `summary` 字段，使其可作为“目录菜单”直接扫描。
- 如来源是评论线程，优先把锚点引用写入 Commands 的 `context_quote`，避免“关于第二段...”这类定位歧义。

### 4.6 历史压缩等级（当检索变慢时的熵控制）

当单项目里程碑过多、页面检索/打开变慢时，允许对“已验收且较久远”的里程碑做渐进压缩，不改变数据库字段，只压缩子页面正文。

- `L0_full`：完整细节（默认）
- `L1_summary`：仅保留 TL;DR、结论、证据、关联决策、下一步结论（移除过程）
- `L2_tldr`：仅保留 1-3 条 TL;DR + 证据链接 + 关联决策 ID

触发建议：

- `accepted` 且超过 30 天：可从 L0 -> L1
- `accepted` 且超过 90 天：可从 L1 -> L2
- 若需回溯细节：以 artifact（PR/报告/截图）为主，不再依赖正文长叙事

---

## 5. 显式任务简报（Why / Context / What）与执行门禁

在 `align` 阶段，或任何一个新任务正式开工前，必须先产出一份最小任务简报，写入以下位置之一：

- 建一个“任务简报页面”并链接到当前 Milestone
- 或写入 Milestone 子页面顶部固定区块

显式任务简报只写三块：

- `Why`：这轮任务目标是什么，为什么现在做，明确不做什么
- `Context`：这轮任务必须读取的资料、前置结论、当前状态、已知约束
- `What`：这轮要交付什么，验收标准是什么，验证证据看什么

共享 Memory、工程审美、协作偏好、通知规则与 guardrails 默认隐式继承，不要求每个任务全文重写。

同时，执行门禁必须写回 Milestones 行的机器可读字段；不得依赖正文里的自由文本标记来判断是否已批准。

### 5.1 任务简报正文必填字段（人读）

- `Why`
  - 目标 / 价值 / 不做什么
- `Context`
  - 必读资料 / 当前状态 / 前置结论 / 已知约束
- `What`
  - 交付物 / 验收标准 / 验证证据

### 5.2 机器可读门禁字段（写回 Milestones 行，字段名暂不改）

- `contract_status`：默认 `draft`；只有变为 `approved`，agent 才能进入 execute
- `contract_url`：Why / Context / What 简报页面或锚点链接
- `approved_by`：拍板人
- `approved_at`：拍板时间

### 5.3 可选字段（复杂场景启用）

- `Dependencies / Interfaces`：依赖与接口
- `Observability / Evals`：观测与评测口径（只要存在“质量判断”，就应该写）
- `Rollout / Rollback`：灰度与回滚策略（涉及线上变更时启用）

门禁规则：

- `execute` 阶段开始前，当前 Milestone 行必须满足：`contract_status=approved` 且 `contract_url` 非空。
- agent 不得通过解析正文里的 `Approved: Yes`、emoji、颜色或任意自然语言表述来推断门禁状态。
- 在同一个已批准 Milestone 内继续推进绿灯子任务时，agent 可以复用已有简报，只增量更新 `Why / Context / What`，不必每次新建长文。
- 未确认之前，agent 只能做探索与准备，不得推进不可逆操作。

---

## 6. 绿 / 黄 / 红 决策信号（写入协议）

### 6.1 绿灯（低风险且不阻塞）

适用条件：

- 低风险
- 不阻塞当前推进
- 错误成本明显低于等待成本

处理方式：

- agent 直接做完
- 不主动 push 企业 IM
- 只写 Notion：更新 Milestones / Commands / artifacts / summary

### 6.2 黄灯（阻塞，但不紧急）

适用条件：

- 当前节点阻塞
- 但还没到必须立刻打断的程度
- 可以先跳过这个节点，继续完成其他能推进的工作

处理方式：

- 写一条 `Decision Requests`：`signal_level=yellow`
- 不主动 push 企业 IM
- 把问题挂到 Notion Review 面板，等待 review window
- agent 应继续寻找其他可并行、可安全推进的工作，不要原地等待

升级规则：

- 如果已经没有其他安全可推进的工作
- 或超过 `escalate_after`
- 或黄灯问题开始逼近不可逆步骤
- 则自动升级为红灯

### 6.3 红灯（阻塞且紧急，或高风险异常）

适用条件：

- 阻塞且紧急
- 或虽然不阻塞，但属于高风险异常
- 例如：线上事故、数据污染、权限问题、不可逆变更即将发生

触发后必须同时做：

1. 通过企业 IM 中的 OpenClaw 立即 push（私聊优先；若在群聊场景则 @ 你并附结构化决策消息）
2. 在 Decision Requests 写一条 `signal_level=red` 且 `status=needs_review` 的记录

执行约束：

- agent 可以继续做准备性工作（收集证据、写方案、跑 dry-run）
- 但不得越过不可逆步骤（例如 schema 变更、索引重建、全链路切换）

### 6.3.1 红灯 Push 协议（默认：企业 IM 中的 OpenClaw）

当存在可用通知通道时，红灯默认需要“数据库记录 + 即时 push”双写，不能只写 Notion 不通知。

推荐通道优先级：

1. 企业 IM 单聊中的 OpenClaw 主动消息
2. 企业 IM 群聊 @你 / OpenClaw 结构化消息
3. 当前对话（仅限企业 IM 通道暂不可用时的临时降级）

OpenClaw 通知入口能力要求：

- 能向用户主动发送单聊消息，或在指定会话中稳定触达
- 能接收用户回复，并把结果写入 Commands / Decision Requests
- 若平台支持结构化卡片 / 按钮，应优先使用，降低“回复歧义”
- 若平台不支持结构化交互，则必须约定文本命令格式，例如 `approve A` / `improve xxx`

Push 内容最小格式：

- `项目`：`PRJ-xxx`
- `决策`：一句话问题
- `推荐方案`：A / B / C
- `理由`：2-3 条
- `为什么现在必须你决定`：为什么不能继续静默推进
- `Notion`：对应 `DR-...` 链接
- `交互动作`：`批准A / 批准B / improve / stop`

Push 行为约束：

- 必须附 Notion 决策链接，避免消息和决策记录脱节
- 若发送的是结构化卡片或按钮，点击动作必须直接回传到服务端，不能要求用户再跳回别的系统输入
- 若只能发送文本消息，则必须给出可解析的固定回复格式，避免自由文本难以落命令
- 若企业 IM 消息发送失败，agent 需要在 Decision Requests 中补写失败说明，并回退到次级通道

### 6.4 三灯与通知行为对照

- 绿灯：直接做，只写 Notion
- 黄灯：先挂起当前节点，继续做别的，只写 Notion
- 红灯：立即 push 企业 IM，并等待你的决策

---

## 7. 命令队列（批注即分发）协议

### 7.1 命令对象是 Commands 表行

Commands 表是唯一可执行指令入口，任何企业 IM 输入或 Notion 批注都要先被适配成行。

### 7.2 并发安全：claim + ack

领取规则：

- agent 在执行前必须把 `status` 改为 `claimed` 并写 `claimed_by`
- 若已被其他 agent claim，不得抢占

完成规则：

- 执行中：`executing`
- 成功：`done` + 写 `ack:CMD-...`
- 失败：`failed` + 失败原因（写在 instruction 或附加字段中）

### 7.3 idempotency_key 规则（必须）

建议格式：

- `manual:<command_id>`
- `comment:<discussion_id>:<comment_id>`
- `im_message:<channel_session_id>:<channel_message_id>`
- `im_action:<channel_message_id>:<action>`
- `im_shortcut:<event_key>:<operator_id>`

约束：

- 命名空间必须按 `source` 隔离；逻辑唯一键按 `source + idempotency_key` 判断。
- 不同来源禁止复用同一前缀语义，避免 IM 与 Notion 事件落到同一去重空间。
- 适配器必须保证同一条事件不会生成多条命令。

### 7.3.1 三类来源适配示例（强烈建议落到实现说明）

- 企业 IM 文本消息：
  - `source=openclaw_im_message`
  - `channel=enterprise_im`
  - `idempotency_key=im_message:<channel_session_id>:<channel_message_id>`
  - `parsed_action=improve`（若无结构化动作，按解析结果写）
  - `instruction=继续推进 PRD 第二阶段`
- 企业 IM 结构化动作：
  - `source=openclaw_im_action`
  - `channel=enterprise_im`
  - `target_type=decision`
  - `target_id=DR-20260323-001`
  - `idempotency_key=im_action:<channel_message_id>:approve_A`
  - `parsed_action=continue`
- Notion 评论事件：
  - `source=notion_comment`
  - `channel=notion`
  - `source_url=<discussion thread url>`
  - `anchor_block_id=<block_id>`
  - `context_quote=<锚点附近引用>`
  - `idempotency_key=comment:<discussion_id>:<comment_id>`
  - `parsed_action=improve`（若未显式标注 action）

### 7.4 企业 IM OpenClaw 适配器（主链路）协议

企业 IM 中已授权的 OpenClaw 是正式命令入口。来自该入口的输入，必须先落成 Commands，再由 agent claim 执行。

支持的输入来源：

- 单聊消息：例如“继续推进 PRD 第二阶段”
- 群聊 @OpenClaw：例如“@bot improve 这份方案的验收标准”
- 结构化动作：例如 `continue / improve / retry / stop / approve_A`
- 快捷操作：例如 `新建任务 / review now / 查看待决策`

适配规则：

- 企业 IM 文本消息：解析为 `instruction`，`source=openclaw_im_message`
- 结构化动作：把 `action.value` 解析为 `parsed_action` 和结构化参数，`source=openclaw_im_action`
- 快捷操作：把 `event_key` 解析为固定命令模板，`source=openclaw_im_shortcut`
- 所有企业 IM 输入都要保存 `channel_session_id`、`channel_message_id`、`operator_id`

响应策略：

- 对用户刚刚在企业 IM 中发起的显式命令，先回一个轻量 ack，避免用户不知道机器人是否收到
- 再写 Commands，并由 agent claim
- 绿灯和黄灯的后续执行结果默认只写 Notion，不主动回企业 IM 刷屏
- 红灯例外：立即主动 push，并把完整记录写入 Notion

### 7.5 Notion 评论适配器（可选）协议

当你更偏好“在文档原地批注而不是发 IM 指令”时，引入评论适配器，把 Notion 评论线程转为 Commands 表行，避免单线程 IM 上下文污染。

适配规则：

- 每条“可触发执行的用户评论 / 用户回复事件”只生成 1 条 Commands 行（靠 `source + idempotency_key` 保证）
- 同一 discussion thread 下允许存在多条命令事件，但不得为同一 `comment_id` 重复生成命令
- Commands 行必须尽量携带锚点上下文：
  - `source_url`：thread 链接
  - `anchor_block_id`：评论锚点 block id
  - `context_quote`：锚点附近引用文本（长度建议 200-600 字），让 agent 精准定位修改对象
- 解析 `parsed_action`：
  - 若评论以 `[continue] / [stop] / [retry] / [improve: ...] / [clarify: ...]` 开头，优先按该 action 解析
  - 否则默认 `improve`，把整段评论作为 `instruction`

agent 回复策略（推荐）：

- agent 处理完命令后，在对应 comment thread 下回复 `ack:CMD-...` + 结果摘要 + 变更证据链接
- 不要用“重写整篇”的方式回应评论，只改锚点关联的最小片段，避免引入无关 diff

---

## 8. Memory 两段式维护（降低冲突噪声）

### 8.1 写入规则

- 执行 agent 不得直接改稳定 Memory 文档，只能写 `Memory Proposals`
- “Memory Curator agent”（建议为独立 subagent）负责在 checkpoint 时合并

### 8.2 合并策略

- 优先把冲突降级为“例外条款”（加 scope），避免把局部例外升级成全局矛盾
- 只有当确实存在全局矛盾时，才写入 Decision Requests（通常为黄灯）等待裁定

### 8.3 Memory Audit 与人工兜底（强制）

- Memory Curator 每次 `merge / reject / rollback / manual override` 都必须写 1 条 `Memory Audit`
- Audit 至少包含：`before_ref`、`after_ref`、`diff_summary`、`operator`、`source_proposals`
- 人工 override 必须被记录成 `action=manual_override`，不能静默覆盖
- 回滚必须是一等操作：若发现 Curator 合并错误，允许直接生成 `rollback` 记录并恢复到上一个已确认版本

### 8.4 Memory Curator subagent 职责边界（强制）

- 唯一允许改“稳定 Memory 文档”的角色
- 负责：
  - triage `Memory Proposals`（去重、合并同义、补 scope）
  - 在 checkpoint 执行 merge，并把结果写回稳定 Memory
  - 同步写入 `Memory Audit`，保留 before / after / diff / source
  - 对冲突条目打 `needs_review`，必要时生成 `Decision Requests (yellow)`
- 不负责：
  - 执行业务任务
  - 代替你做关键方向裁决

### 8.5 Checkpoints（触发时机）

- 关键长期决策落定后
- 完整纵切验收后
- 评测口径发生稳定变化后
- 协作偏好被明确或重复出现
- 发现之前理解需要修正时

---

## 9. Agent 启动序列（强制）

每次会话启动时必须执行：

1. 读取共享 Memory（本地基线或 Notion 镜像）
2. 拉取本 Project 的 Decision Requests：`status in (needs_review, proposed)`，并按 `signal_level=red -> yellow -> green` 优先处理
3. 拉取 Commands：`status in (new, claimed, executing)` 且未被自己 ack
4. 拉取当前 Milestones：`status in (in_progress, ready_for_review)`
5. 若处于 align 阶段，先检查当前 Milestone 是否已有 `Why / Context / What` 简报，且 `contract_status=approved`（不要 parse 正文）

---

## 10. MVP 路线图（按周可交付）

### P0（本周）：跑通收口与分发

- 建 Projects/Milestones/Decision Requests/Commands 四个数据库
- 每个项目建 Dashboard 页（Now + 三个嵌入视图）
- agent 改为写数据库行，不再写长正文
- 每次新任务先生成一版 `Why / Context / What` 简报
- 复用现有企业 IM 中已授权的 OpenClaw 入口，完成 1 次端到端 smoke test：发送测试指令 -> Commands 入库 -> agent claim -> ack 回写
- 配置结构化交互 / 快捷动作（若平台支持）
- 红灯触发时：OpenClaw 主动消息 push + 写 Decision Requests（red）

### P1（下周）：memory 两段式与自动读取

- 增加 Memory Proposals 数据库
- 增加 Memory Audit 数据库
- 上线 Memory Curator agent（按 checkpoint 合并 + 留审计记录）
- agent 启动时自动读取 Memory
- 企业 IM 消息 / 结构化动作 / 快捷操作统一适配为 Commands
- 黄灯升级规则上线：超时或无路可走时自动升红灯

### P2（后续）：评论适配器与依赖治理

- 评论适配器：Notion 评论 -> Commands 行（带 idempotency_key）
- agent 轮询 Commands 自动领任务
- 企业 IM 中的快捷操作与决策消息模板完善
- 多 agent 依赖：用 relation 表达（例如 Milestone depends_on）
- Memory 历史查询、压缩与回放体验优化

---

## 11. 验收标准（可测试）

- 共享 Memory：新 agent 启动后无需重复解释，可引用稳定偏好并遵守 guardrails。
- 任务启动：每个新任务都有一版 `Why / Context / What` 简报；共享 Memory 与 guardrails 通过隐式继承生效。
- 决策信号：红灯触发可在 2 分钟内 push 到位；绿灯 / 黄灯不产生主动 IM 打断。
- Notion 收口：Dashboard 1 屏内可扫描；通过 DB 视图可在 10 分钟内完成全项目 review。
- 闭环分发：你下达的指令进入 Commands 后，agent 可 claim 并执行，完成后写 ack。
- 执行门禁：未获批准的任务简报不会进入 execute；批准后 agent 通过 `contract_status` 而不是正文文本判断门禁。
- Memory 审计：每次 Curator merge 都能追溯 before / after / diff；出现错误时可通过 Audit 记录触发回滚。
- P0 smoke test：企业 IM 发出 1 条测试指令后，30 秒内能看到 Commands 行；agent claim 后能回轻量 ack，完成后能看到结果摘要。
- 注意力保护：无需主动巡逻；非红灯事项不随机打断。
