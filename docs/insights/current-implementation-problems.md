# 当前实现问题诊断与调整方向

> 本文档以最严格的工程标准审视 Vico 当前实现，不回避任何设计缺陷。
> 每个问题包含：现状描述 → 问题本质 → 调整方向。

---

## 一、架构层问题

### 1.1 双引擎：代码复制粘贴式的"架构演进"

**现状:** `pipeline.ts:runPipeline()` 和 `mastra/agent-factory.ts:createMastraAgent()` 是两个几乎完全独立的 pipeline 实现。模型解析、Skill 桥接、RAG 检索、记忆组装、SSE 流式——每一步都是重新实现的。`resolveModelProvider()` 在 `pipeline.ts:62` 和 `model-bridge.ts:14` 中几乎逐字相同。

**问题本质:** 这不是双引擎，这是复制粘贴。增强引擎没有复用 Legacy 的任何代码，Legacy 也没有从增强引擎的 Bridge/Processor 抽象中受益。添加一个功能需要改两处，修一个 bug 要确认两个地方是否都存在。这就是典型的"临时方案变成永久方案"。

**调整方向:**
1. 定义 `PipelineStage` 接口，将 pipeline 拆分为可组合的阶段（模型解析、提示词构建、工具组装、流式输出、后处理）
2. 两个引擎共享 80% 的阶段实现，差异仅在于增强引擎的额外 Processor
3. 引擎选择器不应做 dynamic import + try-catch fallback——这会把启动时的配置错误延迟到首次请求才暴露

### 1.2 记忆系统：四个模块抢一张表

**现状:** ShortTermMemory 独享内存 Map；LongTermMemory、WorkingMemory、ObservationalMemory 共享 `memory_entries` 表，通过 `type` 字段区分（'fact'/'working'/'observation'/'preference'/'summary'/'decision'）。WorkingMemory 和 LTM 使用**完全相同**的正则表达式提取事实（对比 `long-term.ts:65-69` 和 `working-memory.ts:35-37`），只是 `type` 字段不同。

**问题本质:** 这不是分层记忆，是把同一件事做了两遍塞进不同抽屉。LTM 存 `type='fact'`，WorkingMemory 存 `type='working'`，但提取逻辑一模一样。正则 `我(?:喜欢|偏好)/` 在 LTM 里匹配一次，在 WorkingMemory 里又匹配一次。用户说"我喜欢简洁的回复"，结果 `memory_entries` 里出现两条几乎相同的记录，只是 type 不同。

更根本的问题是：`memory_entries` 表充当了万能 JSON 存储——向量检索用、精确类型检索用、对话摘要用、用户偏好用，全部混在一起。`upsertByContent` 按内容前 120 字符去重，但 LTM 的 `store` 方法完全不做去重。ObservationalMemory 插入时 `user_id=''`，检索时用 LIKE 模糊匹配 conversation_id 前缀。

**调整方向:**
1. 统一事实提取入口：一个 `FactExtractor` 同时产出 LTM 事实和 WorkingMemory 偏好，不是两个模块各自用相同的正则匹配一次
2. WorkingMemory 应该有独立的数据结构（key-value），而不是复用 `memory_entries` 的通用 schema
3. 短期记忆应该可以序列化到数据库（服务重启后恢复），纯内存 Map 在生产环境不可接受

### 1.3 SSE 流式：三个地方写三遍

**现状:** SSE ReadableStream 的构建逻辑在 `pipeline.ts:213-258`、`agent-factory.ts:216-268`、`orchestrator.ts:298-405` 三个地方各自实现。每处都重复：`new ReadableStream` → `encoder.encode` → `for await textStream` → `JSON.stringify event` → `data:` 前缀 → `done`/`error` 事件 → 持久化 → 记忆更新 → controller.close()。

**问题本质:** 不仅是代码重复，更致命的是三处的后处理逻辑已经出现 divergence：
- Legacy 在 stream 内直接 INSERT messages（`db.insert(messages)`），增强引擎走 `message-persister` Processor
- Legacy 的 done event 带 `usage: {}`（空对象），Orchestrator 的 done event 是 `{ type: 'done' }`（无 usage 字段）
- 增强引擎多了 `inputProcessor.processInput` 调用，Legacy 和 Orchestrator 没有

**调整方向:**
1. 抽象 `createSSEStream(textStream, callbacks)` 工厂函数
2. `onChunk` / `onDone` / `onError` 回调由调用方注入，流构建逻辑统一
3. SSE 事件格式需要定义严格的类型契约，不是每个地方手写 JSON.stringify

### 1.4 正则提取事实：用锤子敲螺丝

**现状:** LTM 和 WorkingMemory 的事实提取完全依赖正则表达式：
```
/我(?:喜欢|偏好|习惯|想要|希望|更倾向于)(.+)/
/(?:以后|下次|将来|每次)(.+)/
/我(?:是|叫|在|做|使用)(.+)/
```

**问题本质:** 这是用 1980 年代的技术做 2026 年的 AI 产品。

- "我不喜欢太啰嗦的回答" → 匹配 "喜欢太啰嗦的回答"，事实完全相反
- "我以后再也不相信天气预报了" → 匹配为行为偏好，实际上是一句吐槽
- "我在北京工作，但我更喜欢远程办公" → 只匹配前半句
- 英文用户？完全无法提取
- 隐含偏好？"上次那个方案太复杂了" → 什么都匹配不到
- 否定句式？"不要用表格" → 匹配不到

好消息是 `extractAndStore` 被标记为 `.catch(() => {})` 异步丢弃，意味着提取失败不会影响用户体验。坏消息是：它大概率也提取不到什么有用的东西，用户在对话中透露的偏好 90% 以上不会命中这几个贫瘠的正则。

**调整方向:**
1. 用 LLM 做事实提取（在 onFinish 回调中用一次额外的轻量 LLM 调用，或复用 streamText 的 response 做结构化提取）
2. 这一步已经是最佳时机——对话刚完成，上下文完整，一次 `generateObject` + Zod schema 就能提取结构化事实
3. 如果担心成本/延迟，至少用 embedding 相似度 + 预定义事实类别做分类，而不是 6 个正则打天下

---

## 二、数据层问题

### 2.1 向量检索：全表扫描式"相似度搜索"

**现状:** `long-term.ts:46-48` 和 `rag.ts:86` 的检索逻辑是：
```typescript
// 加载最近 500 条到内存
db.prepare('SELECT * FROM memory_entries ... LIMIT 500').all()
// 逐条计算余弦相似度
rows.map(r => cosineSimilarity(queryEmb, blobToFloat32(r.embedding)))
```

**问题本质:** 这是 O(n) 的暴力搜索，不是向量检索。每次检索都要把整个 BLOB 列从 SQLite 反序列化为 Float32Array。500 条 x 384 维 = 768KB 数据传输。10000 条 = 15MB。更重要的是，内存中逐条计算余弦相似度的 JS 循环在 10000 条级别会明显阻塞事件循环。

RAG 的 `hybridSearch` 更糟——语义搜索和关键词搜索各自做一次全表加载（`LIMIT 2000`），然后 JS 中合并。

当前体量（几百条 chunks、几十条记忆）完全感受不到问题，但这是一个随着数据增长会突然崩溃的设计，而不是一个会逐渐变慢的线性退化。

**调整方向:**
1. 短期：给 `memory_entries.embedding` 列加索引？SQLite 不支持向量索引。但至少可以限制检索范围（按 type 过滤、按时间衰减加权）
2. 中期：sqlite-vss（向量搜索扩展）或 LanceDB（嵌入式向量数据库）替代 BLOB + 全表扫描
3. 长期：独立向量数据库（Qdrant/Milvus），或至少 pgvector（切换到 PostgreSQL）

### 2.2 API Key 明文存储

**现状:** `model_configs` 表的字段叫 `api_key_encrypted`，暗示它应该被加密。但实际上：
- `model-registry.ts` 直接把它传给 `createOpenAI({ apiKey })`，没有任何解密步骤
- 前端 `/settings` 页面用 `<Input type="password">` 遮住显示，但 API 返回时就是明文
- YAML 配置文件支持 `${OPENAI_API_KEY}` 环境变量插值，但数据库存储的 key 没有任何保护

**问题本质:** 字段名叫 `encrypted` 但从未被加密。这是安全幻觉，比直接叫 `api_key` 更危险——因为后来的维护者会以为它已经被保护。

**调整方向:**
1. 要么改名 `api_key` 并接受明文存储（私有部署可接受）
2. 要么真正实现加密：用环境变量 `ENCRYPTION_KEY` 做 AES-256-GCM 加解密，`api_key_encrypted` 存密文，`resolveModelProvider` 中解密
3. 前端 API 响应永远不返回完整 API Key（只返回 `sk-***xxxx` 掩码形式）

### 2.3 数据库 Schema 缺少关键索引

**现状:** 除了主键和外键，业务表没有任何自定义索引。以下查询是全表扫描：
- `WHERE tenant_id = ? AND type = ? ORDER BY importance DESC`（WorkingMemory 检索）
- `WHERE tenant_id = ? AND type = ? AND content LIKE ?%`（ObservationalMemory 检索）
- `WHERE conversation_id = ? ORDER BY created_at DESC`（消息历史查询）

**调整方向:**
1. `memory_entries(tenant_id, type, importance)` 复合索引
2. `messages(conversation_id, created_at)` 复合索引
3. `conversations(tenant_id, updated_at)` 复合索引（对话列表排序）

---

## 三、Agent 引擎层问题

### 3.1 团队编排：名称叫"协作"，实际是"排队"

**现状:** `orchestrator.ts` 的 Supervisor + Delegation 模式中：
- 每个子 Agent 调用是**完全独立**的——独立加载 Agent 配置、独立构建 prompt、独立执行 streamText
- 子 Agent 之间**完全没有通信**——Agent A 不知道 Agent B 被委派了什么任务，不知道 B 的结果
- Supervisor 通过 tool call 委派，**同步等待**每个子 Agent 完成（`delegateToAgent` 是 async/await，在 tool execute 中阻塞）
- 子 Agent 的 STM/LTM 完全隔离——每个委派都是"第一次见面"

**问题本质:** 这不是多 Agent 协作，这是"一个人分别打电话问三个人，然后汇总"。真正的协作需要：
- 共享上下文（子 Agent 知道彼此在做什么）
- 并行执行（Supervisor 可以同时委派多个 Agent 而不是排队）
- 中间通信（Agent A 的输出可能是 Agent B 的输入）

当前实现中，如果 Supervisor 委派了 3 个 Agent，总延迟 = Agent A 延迟 + Agent B 延迟 + Agent C 延迟 + Supervisor 整合延迟。如果是并行，总延迟 = max(A, B, C) + Supervisor 延迟。

**调整方向:**
1. 委派工具应该返回 Promise，让 AI SDK 的 maxSteps 循环自然处理并行 tool calls
2. 子 Agent 间引入共享消息总线或黑板模式（Blackboard Pattern）
3. 评估是否真正需要多 Agent。对于大多数中小企业场景，一个配置良好的 Agent + 多个 Skill 工具已经足够。"团队"的概念应该在确实需要异构 Agent 协作时才引入

### 3.2 maxSteps=10 是拍脑袋的硬编码

**现状:** 单 Agent `maxSteps=10`（pipeline.ts:188, agent-factory.ts:192），子 Agent `maxSteps=5`（orchestrator.ts:108），Supervisor `maxSteps=15`（orchestrator.ts:320）。

**问题本质:** 没有解释为什么是这些数字。如果 Agent 的 tool call 需要 11 步怎么办？如果 Skill 工具互相依赖形成链式调用怎么办？当前 design 是"猜一个数，不够再加"，但用户不会知道为什么 Agent 突然停止执行。

**调整方向:**
1. maxSteps 应该是 Agent 级别的配置项（`agents` 表增加 `max_steps` 字段）
2. 或者根据 Agent 绑定的 Skill 工具数量动态计算：`maxSteps = baseSteps + tools.length * 2`

### 3.3 工具执行没有超时和重试

**现状:** `tool-executor.ts` 的 execute 方法没有超时控制，没有重试机制。Skill 开发者的 `handler` 函数如果写了 `while(true){}`，整个请求就永远挂起。如果 handler 抛异常，被 `onStepFinish` 的 `.catch(()=>{})` 吞掉，模型看到的是 undefined 的工具返回结果。

**调整方向:**
1. 每个 tool handler 执行包裹 `Promise.race(toolPromise, timeout(30s))`
2. 工具返回结果需要有明确的 error 结构（`{ error: string }`），而不是让模型看到 undefined
3. Skill 工具的 handler 应该声明式地标记是否可重试（幂等工具可重试，有副作用的不可重试）

---

## 四、可观测性问题

### 4.1 日志策略：console.log 不是可观测性

**现状:** 整个后端的日志策略是：
- `console.log('[Tool] xxx: OK')`（pipeline.ts:204）
- `console.log('[RAG] Indexed: xxx')`（rag.ts:71）
- `console.error('[RAG] Failed to index xxx:', err)`（rag.ts:73）
- `console.error('[EnhancedEngine] Error, falling back:', err)`（pipeline.ts:288）
- 错误被 `.catch(() => {})` 静默吞掉（至少 6 处）
- `onStepFinish` 的工具调用日志在 Legacy 中被 `console.log` 输出，在增强引擎中被 `audit-logger` 存库——两套不同的可观测性路径

**问题本质:** 在生产环境中，这些 console.log 会混入 Node.js 的事件循环诊断、依赖库的 debug 输出、以及真正的错误日志。无法按级别过滤、无法按请求 trace、无法聚合统计。

更严重的是 `.catch(() => {})`——这不仅不是"非关键路径可静默"，而是"出了问题你永远不知道"。

**调整方向:**
1. 引入结构化日志库（pino/winston），最低要求：每条日志带 `requestId`、`tenantId`、`agentId`
2. 为每个请求生成 traceId，贯穿 pipeline 各阶段
3. `.catch(() => {})` 替换为 `.catch(err => logger.warn({ err, component: 'ltm-extract' }, 'LTM extraction failed'))`
4. 工具执行成功/失败、Token 用量、pipeline 各阶段耗时应该有 metrics 埋点（至少 console 级别的结构化日志，未来可接 Prometheus）

### 4.2 没有健康检查端点

**现状:** 没有 `/health`、`/ready`、`/live` 端点。服务是否正常运行只能通过业务接口推断。

**调整方向:**
1. 添加 `GET /health`（进程存活）、`GET /ready`（DB 可连接 + 嵌入模型已加载）

---

## 五、前端层问题

### 5.1 表单管理：回到 jQuery 时代

**现状:** 所有表单使用原生 `useState` + `onChange` 管理：
- AgentDetail 页面有 4 个独立 `useState` 用于配置参数
- 防抖保存用 300ms `setTimeout` + `useRef` 标记 dirty 状态
- 没有表单校验、没有 dirty tracking 标准模式、没有批量保存

**问题本质:** "已经有了 react-hook-form 和 TanStack Form，但我们在手写每一个 input 的 onChange。"

当前 AgentDetail 的 ConfigPanel 有 3 个防抖保存——system prompt、temperature、max tokens——各自独立触发 PUT 请求。用户改一个字，300ms 后一次请求；再改一个字，又一次请求。如果用户快速修改 system prompt，会产生一连串的 PUT 请求互相竞争，后端以什么顺序处理完全取决于网络延迟。

**调整方向:**
1. 引入 react-hook-form 或 TanStack Form 管理表单状态
2. 防抖应该防的是提交行为，不是单个字段。整个表单应该有一个统一的 "保存" 触发时机（可以是自动保存，但应该是 debounced form-level submit，不是 per-field PUT 请求）
3. 对于 toggle 类操作（Skill 绑定/解绑），使用乐观更新（`onMutate` 立即更新 UI，`onError` 回滚）

### 5.2 SSE 解析：自己造轮子

**现状:** `api/client.ts` 的 `streamChat` 和 `streamTeamChat` 手动实现了 SSE 解析：`fetch` → `response.body.getReader()` → `TextDecoder` → 按 `\n` 分割 → 检查 `data:` 前缀 → `JSON.parse`。

**问题本质:** AI SDK v4 的 `@ai-sdk/react` 已经提供了 `useChat` hook，自动处理 SSE 流、消息状态管理、abort、重连。当前实现等于用 fetch 重新发明了 AI SDK 的 streaming client。

**调整方向:**
1. 评估是否可以直接使用 AI SDK 的 `useChat`（需要后端兼容其 API 格式）
2. 如果不能（因为后端格式是自定义的），至少封装一个 `useSSEStream` hook，而不是在每个使用 SSE 的组件中重复 ReadableStream 样板代码

### 5.3 国际化：硬编码中文

**现状:** 所有 UI 文本硬编码为中文字符串，零 i18n 基础设施。`<Button>创建 Agent</Button>`、`<EmptyTitle>暂无数据</EmptyTitle>` 散布在 20+ 个组件中。

**调整方向:**
1. 短期不需要支持多语言，但至少应该将 UI 字符串集中管理（一个 `messages.ts` 或 i18n key 映射）
2. 如果未来要国际化，现在开始用 `react-intl` 或 `i18next` 的成本远低于以后迁移

### 5.4 组件拆分：一个文件 400 行也算"可理解"

**现状:** `react-best-practices.md` 规定"400 行仍可理解则不拆"。但 AgentDetail 页面把所有 4 个 Tab 的管理逻辑（数据获取、防抖、状态管理）都写在一个文件里。

**问题本质:** 行的上限不是问题，关注点混在一起才是。一个文件同时管理 ConfigPanel 的防抖逻辑、SkillPanel 的 checkbox toggle、KnowledgePanel 的绑定列表、ChatPanel 的流式状态，这不是"可理解"，而是"改动一处时担心影响其他三处"。

**调整方向:**
1. 当前的 Tab 结构已经暗示了正确的拆分方向——每个 Tab 面板应该是独立组件，有自己的数据获取和状态管理
2. 共享数据（agent 详情）通过 TanStack Query 的缓存共享，而不是通过 props 层层传递

---

## 六、工程质量问题

### 6.1 零测试覆盖率

**现状:** `vitest.config.ts` 存在，`vitest` 在 devDependencies 中，但只有 `api/__tests__/teams.test.ts` 和 `memory/__tests__/long-term-upgrade.test.ts` 两个测试文件。核心模块——pipeline、orchestrator、model-registry、skill-manager、tool-executor——零测试覆盖。

**问题本质:** MVP 阶段不写测试，这可以理解。但 pipeline 和 orchestrator 这样的核心业务流程，没有测试意味着：
- 重构双引擎时无法验证行为一致性
- 修改 prompt 组装逻辑时不知道是否影响 RAG/LTM/WorkingMemory 注入
- 引擎切换（legacy ↔ mastra）没有回归测试

**调整方向:**
1. 优先为 pipeline 的核心纯函数写单元测试：`jsonSchemaToZod`、`resolveModelProvider`、prompt 组装逻辑
2. 集成测试至少覆盖：创建 Agent → 发送消息 → 验证响应包含 SSE 事件
3. 用 mock AI SDK（`vi.mock('ai')`）隔离 LLM 调用

### 6.2 TypeScript 类型安全：any 泛滥

**现状:**
- `allMessages as any`（pipeline.ts:186, agent-factory.ts:190）
- `model as any`（agent-factory.ts:188, orchestrator.ts:104）
- `as any` 在代码库中出现 20+ 次
- `ToolContext` 中的 `skillConfig: {}` 字面量类型 vs 实际应该是 `Record<string, unknown>`
- `onStepFinish` 的 `event.toolCalls` 类型未正确收窄（AI SDK 的 ToolCall 联合类型需要 type guard）

**问题本质:** AI SDK 的类型确实复杂（`CoreMessage`、`ToolSet`、`LanguageModel` 等都是泛型工厂类型），但 `as any` 绕过类型检查也会绕过 AI SDK 版本升级时的 breaking change 编译时检测。

**调整方向:**
1. 从源头解决——定义 `AISDKTools` 和 `AISDKMessage` 等类型别名，正确范型化
2. `as any` 逐处替换为正确的类型断言或 type guard
3. 在 tsconfig 中开启 `noUncheckedIndexedAccess` 和更强的 strict 选项（逐步）

### 6.3 配置双源：YAML + 数据库 = 混乱

**现状:** LLM 模型配置同时存在于：
- `server.config.yaml` 的 `llm.models` 数组
- `model_configs` 数据库表（通过管理后台 `/settings` 管理）

两处都有 `is_default` 概念，但 YAML 中的配置在首次启动后就被忽略（因为 `model-registry.ts` 只查数据库）。`llm.models: []` 默认是空数组，用户必须通过 UI 添加模型——但 YAML 里明明有 `models` 字段。

**调整方向:**
1. 明确单一数据源：数据库为主，YAML 仅作为首次初始化 seed 数据
2. 启动时如果 `model_configs` 表为空，将 YAML 中的模型配置同步到数据库（seed）
3. YAML 中移除 `llm.models`，替换为 `llm.default_provider`（仅起提示作用）

---

## 七、安全性问题

### 7.1 无速率限制差异化

**现状:** `index.ts` 中有一个内存限流器，100 req/min/IP，对所有端点统一应用。

**问题:** 登录接口和聊天接口不应共享同一速率限制。聊天接口 SSE 流会持续占用连接 30-60 秒，每个 SSE chunk 不应该被计数。

**调整方向:**
1. 登录/注册：5 req/min/IP（防暴力破解）
2. Chat SSE：10 req/min/user（按 userId 限流，非 IP）
3. 普通 CRUD API：100 req/min/user

### 7.2 无文件上传安全校验

**现状:** 知识库文档上传（`knowledge.ts`）接受 `.pdf/.txt/.md/.csv`，但没有：
- 文件大小限制（用户可上传 1GB CSV）
- 文件内容校验（可上传改扩展名的二进制文件）
- 上传速率限制

**调整方向:**
1. 添加文件大小限制（10MB）
2. magic bytes 校验（检测文件真实类型，不信任扩展名）
3. PDF 解析添加页面限制（防止 1000 页 PDF 撑爆内存）
