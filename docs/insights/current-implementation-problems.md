# 当前实现问题诊断与调整方向

> 本文档以最严格的工程标准审视 Vico 当前实现，不回避任何设计缺陷。
> 每个问题包含：现状描述 → 问题本质 → 调整方向。
> 已通过 Mastra 迁移解决的问题已移除（双引擎消除、SSE 统一、向量检索升级、健康检查）。

---

## 一、架构层问题

### 1.1 记忆系统：两个模块共享一张表

**现状:** 旧 LongTermMemory 已删除，语义记忆由 Mastra Memory 的 semanticRecall + LibSQLVector 接管。但 WorkingMemory 和 ObservationalMemory 仍共享 `memory_entries` 表（通过 raw SQL `getClient().execute()` 直接操作，不在 Drizzle ORM schema 中），通过 `type` 字段区分（'working'/'observation'/'summary'）。两者使用**完全相同**的正则表达式提取事实（对比 `working-memory.ts:34-38` 和 `observational-memory.ts` 的提取逻辑）。

**问题本质:** 旧 LTM 已移除是进步，但 WorkingMemory 和 ObservationalMemory 仍在用 raw SQL 争用同一张没有 Drizzle schema 定义的表。`upsertByContent` 按内容前 120 字符去重，但跨模块去重逻辑各自实现。ObservationalMemory 插入时 `user_id=''`，检索时用 LIKE 模糊匹配 conversation_id 前缀。

**调整方向:**
1. 将 WorkingMemory 和 ObservationalMemory 也迁移到 Mastra Memory API，或至少给 `memory_entries` 表加回 Drizzle schema 定义和索引
2. WorkingMemory 应该有独立的数据结构（key-value），而不是复用通用 schema
3. 统一事实提取入口：一个 `FactExtractor` 同时产出 WorkingMemory 偏好和 ObservationalMemory 摘要

### 1.2 正则提取事实：用锤子敲螺丝

**现状:** WorkingMemory 的事实提取完全依赖正则表达式：
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

### 2.1 API Key 明文存储

**现状:** `model_configs` 表的字段叫 `api_key_encrypted`，暗示它应该被加密。但实际上：
- `agent-factory.ts` 直接把它传给 `createOpenAI({ apiKey })`，没有任何解密步骤
- 前端 `/settings` 页面用 `<Input type="password">` 遮住显示，但 API 返回时就是明文
- YAML 配置文件支持 `${OPENAI_API_KEY}` 环境变量插值，但数据库存储的 key 没有任何保护

**问题本质:** 字段名叫 `encrypted` 但从未被加密。这是安全幻觉，比直接叫 `api_key` 更危险——因为后来的维护者会以为它已经被保护。

**调整方向:**
1. 要么改名 `api_key` 并接受明文存储（私有部署可接受）
2. 要么真正实现加密：用环境变量 `ENCRYPTION_KEY` 做 AES-256-GCM 加解密，`api_key_encrypted` 存密文，`resolveModelProvider` 中解密
3. 前端 API 响应永远不返回完整 API Key（只返回 `sk-***xxxx` 掩码形式）

### 2.2 数据库 Schema 缺少关键索引

**现状:** `conversations` 和 `messages` 表已移除（由 Mastra 接管）。但 `memory_entries` 表不再有 Drizzle ORM 定义（raw SQL 直接操作），导致没有任何索引声明。以下查询是全表扫描：
- `WHERE tenant_id = ? AND type = ? ORDER BY importance DESC`（WorkingMemory 检索）
- `WHERE tenant_id = ? AND type = ? AND content LIKE ?%`（ObservationalMemory 检索）

其余业务表除了主键和外键也没有自定义索引。

**调整方向:**
1. 给 `memory_entries` 表加回 Drizzle schema 定义，或至少通过 migration 添加 `(tenant_id, type, importance)` 复合索引
2. `agentTeams(tenant_id)` 索引
3. `agent_skills(agent_id, skill_name)` 复合索引

---

## 三、Agent 引擎层问题

### 3.1 团队编排：已 stub，待重写

**现状:** 旧 `orchestrator.ts` 的完整实现已删除。当前是一个 stub，直接返回 SSE 错误流：`"Team chat is being migrated to Mastra agent.network(). This feature is temporarily unavailable."`。

**问题本质:** 团队编排功能暂时不可用。旧实现的问题（子 Agent 串行排队、无共享上下文）虽然不存在了，但替代方案尚未实现。

**调整方向:**
1. 用 Mastra 的 `agent.network()` 或 Workflow 重新实现团队协作
2. 子 Agent 间引入共享消息总线或黑板模式（Blackboard Pattern）
3. 评估是否真正需要多 Agent。对于大多数中小企业场景，一个配置良好的 Agent + 多个 Skill 工具已经足够

### 3.2 maxSteps=10 是拍脑袋的硬编码

**现状:** `agent-factory.ts:150` 中 `maxSteps: 10`。没有解释为什么是这个数字。

**问题本质:** 如果 Agent 的 tool call 需要 11 步怎么办？如果 Skill 工具互相依赖形成链式调用怎么办？当前 design 是"猜一个数，不够再加"，但用户不会知道为什么 Agent 突然停止执行。

**调整方向:**
1. maxSteps 应该是 Agent 级别的配置项（`agents` 表增加 `max_steps` 字段）
2. 或者根据 Agent 绑定的 Skill 工具数量动态计算：`maxSteps = baseSteps + tools.length * 2`

### 3.3 工具执行没有超时和重试

**现状:** `skill-tool-adapter.ts` 的 execute 方法直接 delegate 到 Skill handler，没有超时控制，没有重试机制。Skill 开发者的 `handler` 函数如果写了 `while(true){}`，整个请求就永远挂起。

**调整方向:**
1. 每个 tool handler 执行包裹 `Promise.race(toolPromise, timeout(30s))`
2. 工具返回结果需要有明确的 error 结构（`{ error: string }`），而不是让模型看到 undefined
3. Skill 工具的 handler 应该声明式地标记是否可重试（幂等工具可重试，有副作用的不可重试）

---

## 四、可观测性问题

### 4.1 日志策略：console.log 不是可观测性

**现状:** 整个后端的日志策略是：
- Processor 现在输出 JSON 结构化格式（`console.log(JSON.stringify({...}))`），比纯字符串有改进
- `console.log('[RAG] Indexed: xxx')`（rag.ts）
- `console.error('[RAG] Failed to index xxx:', err)`（rag.ts）
- 错误被 `.catch(() => {})` 静默吞掉（至少 6 处）
- `sse-utils.ts` 中 `usage.catch(() => undefined)` 静默丢弃 Token 统计错误

**问题本质:** 在生产环境中，这些 console.log 会混入 Node.js 的事件循环诊断、依赖库的 debug 输出。无法按级别过滤、无法按请求 trace、无法聚合统计。

更严重的是 `.catch(() => {})`——这不仅不是"非关键路径可静默"，而是"出了问题你永远不知道"。

**调整方向:**
1. 引入结构化日志库（pino/winston），最低要求：每条日志带 `requestId`、`tenantId`、`agentId`
2. 为每个请求生成 traceId，贯穿 pipeline 各阶段
3. `.catch(() => {})` 替换为 `.catch(err => logger.warn({ err, component: 'ltm-extract' }, 'LTM extraction failed'))`
4. 工具执行成功/失败、Token 用量、pipeline 各阶段耗时应该有 metrics 埋点

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

**问题本质:** AI SDK 的 `@ai-sdk/react` 已经提供了 `useChat` hook，自动处理 SSE 流、消息状态管理、abort、重连。当前实现等于用 fetch 重新发明了 AI SDK 的 streaming client。

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

**现状:** 从 2 个测试文件增加到 4 个（新增 `orchestrator.test.ts` 和 `observational-memory.test.ts`）。但核心模块——agent-factory、sse-utils、model-registry、skill-tool-adapter、rag-tool、skill-manager——仍零测试覆盖。

**问题本质:** MVP 阶段不写测试，这可以理解。但 agent-factory 和 sse-utils 这样的核心业务流程，没有测试意味着：
- 修改 model 解析逻辑时不知道是否影响所有 provider
- 修改 SSE 事件格式时不知道前端是否兼容
- 添加新 processor 时没有回归测试

**调整方向:**
1. 优先为 agent-factory 的核心纯函数写单元测试：`resolveModelProvider`、prompt 组装逻辑
2. 集成测试至少覆盖：创建 Agent → 发送消息 → 验证 SSE 事件格式
3. 用 mock AI SDK 隔离 LLM 调用

### 6.2 TypeScript 类型安全：剩余 any

**现状:** Mastra 迁移后 `agent/` 目录中已消除所有 `as any`。剩余 3 处 `as any` 在 `api/auth.ts` 和 `api/helpers.ts` 中，均为 better-auth session 类型兼容性 cast（`activeOrganizationId` 字段）。

**问题本质:** better-auth 的 session 类型与运行时结构不完全匹配，3 处 `as any` 是妥协方案。虽比迁移前的 20+ 处大幅改善，但仍需关注。

**调整方向:**
1. 为 better-auth session 扩展自定义类型声明
2. 如果 better-auth 版本升级后类型修复，移除这些 cast

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
