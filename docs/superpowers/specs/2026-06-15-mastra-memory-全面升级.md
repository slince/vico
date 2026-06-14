# Mastra Memory 模块全面升级设计

## 概述

将 Vico 自建的 WorkingMemory/ObservationalMemory 替换为 Mastra 原生 4 层 memory processors（MessageHistory + WorkingMemory + SemanticRecall + ObservationalMemory），消除双轨架构，激活 Mastra 框架级 memory pipeline 的自动编排能力。

**技术决策：** 全部使用 Mastra 原生 Memory processors，删除自建实现。Memory 传入 Mastra 构造函数以激活框架级 `getInputProcessors`/`getOutputProcessors` 自动管线。自建 `memory_entries` 表数据通过迁移脚本导入 Mastra Storage。

---

## 一、当前状态分析

### 1.1 已实现

```
┌─────────────────────────────────────────────────────────────┐
│                    Mastra Memory (当前)                       │
│                                                              │
│  ✅ Storage: LibSQLStore (thread/messages 持久化)            │
│  ✅ Vector:  LibSQLVector (RAG 向量)                         │
│  ✅ Embedder: ModelRouterEmbeddingModel (仅 API 模式)        │
│  ✅ MessageHistory: lastMessages=10 (自动上下文窗口)          │
│  ✅ Thread API: saveThread/listThreads/getThreadById/recall  │
│                                                              │
│  ❌ WorkingMemory: 未启用                                   │
│  ❌ SemanticRecall: 未配置                                   │
│  ❌ ObservationalMemory: 未启用                              │
│  ❌ Memory 未传入 Mastra 构造函数                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               自建 Memory 实现 (当前)                         │
│                                                              │
│  WorkingMemory (agent/memory/working-memory.ts)              │
│  ├─ LLM generateObject + Zod schema 提取用户事实             │
│  ├─ 存 memory_entries 表 (type='working')                    │
│  ├─ 120字符前缀去重                                          │
│  └─ chat.ts onComplete 中手动调用                             │
│                                                              │
│  ObservationalMemory (agent/memory/observational-memory.ts)  │
│  ├─ 规则截断拼接 (200字符/条) 而非 LLM 摘要                   │
│  ├─ 存 memory_entries 表 (type='observation')                │
│  ├─ raw SQL 直接查 Mastra messages 表                        │
│  └─ maybeCompress() 定义了但从未被调用                        │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 缺陷清单

| # | 缺陷 | 严重度 | 影响 |
|---|------|--------|------|
| 1 | Memory 未传入 Mastra 构造函数 | 🔴 架构级 | 框架级 memory pipeline 未激活，所有 processor 无法自动编排 |
| 2 | 自建 WorkingMemory 替代 Mastra 原生 | 🔴 架构级 | 双轨维护，无法享受 Mastra 自动注入/更新/语义检索 |
| 3 | SemanticRecall 完全未配置 | 🔴 功能缺失 | 无跨对话语义回忆，每次对话都是"失忆"状态 |
| 4 | ObservationalMemory 从未被调用 | 🔴 功能缺失 | 长对话超 token 限制时直接溢出，不触发压缩 |
| 5 | 摘要用规则截断而非 LLM | 🟡 质量 | 摘要信息密度低，丢失语义 |
| 6 | 双轨存储 (Mastra mastra_* + Vico memory_entries) | 🟡 数据割裂 | 数据分散两套系统，未来迁移困难 |
| 7 | raw SQL 查 Mastra 内部 messages 表 | 🟡 耦合 | Mastra 版本升级可能改变内部 schema |
| 8 | 无记忆过期/清理机制 | 🟢 积累 | 旧记忆无限增长 |
| 9 | 去重用 120 字符前缀而非语义 | 🟢 精度 | 语义相同但表述不同的内容重复存储 |

---

## 二、目标架构

### 2.1 升级后架构

```
┌─────────────────────────────────────────────────────────────┐
│              Mastra Constructor (mastra.ts)                   │
│                                                              │
│  new Mastra({                                                │
│    agents: { mainAgent, agentProxy },                        │
│    storage: getStorage(),                                    │
│    memory: { memory: getMemory() },   // ← 新增框架级注册   │
│  })                                                          │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              Mastra Memory (全面升级后)                       │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Input Processors (每次请求前自动执行)                │    │
│  │                                                      │    │
│  │  1. MessageHistory  — 加载最近 20 条消息              │    │
│  │  2. WorkingMemory   — 检索用户画像/偏好注入上下文      │    │
│  │  3. SemanticRecall  — 向量检索跨对话相关记忆 (topK=5) │    │
│  │  4. OM Retrieval    — 注入已生成的观察摘要             │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│                    Agent 推理                                 │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Output Processors (每次请求后自动执行)               │    │
│  │                                                      │    │
│  │  1. MessageHistory  — 持久化本轮消息                   │    │
│  │  2. WorkingMemory   — Agent 通过 updateWorkingMemory  │    │
│  │                       tool 自动更新用户事实             │    │
│  │  3. SemanticRecall  — 向量化并存储新消息               │    │
│  │  4. OM Observation  — 检查 token 阈值，跨过时异步      │    │
│  │                      触发 LLM 摘要 + 向量索引          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  配置:                                                       │
│  ├─ lastMessages: 20                                         │
│  ├─ workingMemory: { enabled: true, template: "中文模板" }   │
│  ├─ semanticRecall: { topK: 5, messageRange: {2,2} }        │
│  └─ observationalMemory: true                                │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 记忆层级对照

| 层级 | Vico 当前 | Mastra 目标 | 迁移策略 |
|------|----------|------------|---------|
| 消息历史 | Mastra lastMessages=10 | Mastra lastMessages=20 | 调参 |
| 工作记忆 | 自建 WorkingMemory (LLM extract + memory_entries) | Mastra WorkingMemory processor (agent tool 自动更新) | 替换 + 数据迁移 |
| 语义回忆 | ❌ 不存在 | Mastra SemanticRecall (向量自动检索) | 新增 |
| 观察记忆 | 自建 ObservationalMemory (规则截断 + 未调用) | Mastra OM engine (LLM 摘要 + 异步缓冲 + 向量检索) | 替换 |

### 2.3 数据流

```
用户发送消息
    │
    ▼
chat.ts: executeAgentChat()
    │
    ├─ saveThread() → Mastra Memory API
    │
    ├─ mastra.getAgent(id).stream(messages, { memory: {thread, resource} })
    │       │
    │       ▼
    │   Mastra 自动执行 getInputProcessors():
    │       ├─ MessageHistory: 从 LibSQLStore 加载最近 20 条
    │       ├─ WorkingMemory: 从 Storage 检索用户画像 → 注入上下文
    │       ├─ SemanticRecall: 向量相似度搜索 → 注入相关历史
    │       └─ OM: 注入已有观察摘要
    │       │
    │       ▼
    │   Agent 推理 (LLM + Tools)
    │   ├─ updateWorkingMemory tool 自动可用
    │   └─ recall tool 自动可用 (查历史消息详情)
    │       │
    │       ▼
    │   Mastra 自动执行 getOutputProcessors():
    │       ├─ MessageHistory: 持久化新消息
    │       ├─ WorkingMemory: 持久化 agent 更新的用户事实
    │       ├─ SemanticRecall: 向量化新消息并索引
    │       └─ OM: 检查 token 阈值 → 异步 LLM 摘要 (如需要)
    │
    ├─ SSE stream → 前端
    │
    └─ onComplete: 空操作 (全部由 Mastra processor pipeline 自动管理)
```

---

## 三、设计决策

### 3.1 WorkingMemory: 中文模板

Mastra 原生 WorkingMemory 使用 template 机制 — agent 通过调用 `updateWorkingMemory` tool，将用户信息填入预定义的 Markdown/JSON 模板。模板跨对话持久化，agent 每次对话都能看到。

选择 Markdown 格式（而非 JSON），因为：
- 中文用户事实更适合自然语言描述
- Markdown 模板对 agent 更友好，提示词更自然
- JSON schema 需要严格的字段定义，用户事实结构难以提前穷举

```markdown
# 用户信息
- **称呼**: 
- **位置**: 
- **职业**: 
- **兴趣**: 
- **目标**: 
- **偏好**: 
- **重要事项**: 
```

Mastra 默认 WorkingMemory scope 为 `"resource"`（= tenantId 级别），同一租户的所有对话共享一份用户画像。这符合 Vico 的租户隔离模型。

### 3.2 SemanticRecall: 跨对话语义回忆

`semanticRecall: true` 或 `semanticRecall: { topK: 5 }` 激活向量语义检索。每次请求时，Mastra 自动用最近一条用户消息作为 query，在向量库中检索最相关的历史消息，注入当前对话上下文。

**关键参数：**
- `topK: 5` — 每次检索 5 条最相关历史消息
- `messageRange: { before: 2, after: 2 }` — 每条结果附带其前后各 2 条消息作为上下文
- scope 默认 `"thread"` — 当前对话内检索；改为 `"resource"` 可跨所有对话检索

依赖条件：
- `embedder` 已配置（当前 `ModelRouterEmbeddingModel('openai/text-embedding-3-small')`）
- `vector` 已配置（如果不传，SemanticRecall 在当前版本 Mastra 中使用 LibSQLStore 自带的向量检索能力）

### 3.3 ObservationalMemory: 自动 LLM 摘要

Mastra 原生 OM engine 是一套完整的对话观测系统：

- **Observation（观测）：** 当消息累计 token 数超过 `messageTokens` 阈值（默认 30000 tokens），使用 LLM 生成结构化观察摘要
- **Reflection（反思）：** 当累积的观察数量超过 `observationTokens` 阈值（默认 40000 tokens），使用 LLM 对多个观察做二次整合
- **Async buffering（异步缓冲）：** `bufferTokens: 0.2` — 每增加 20% 阈值 token 数检查一次；`bufferActivation: 0.8` — 保留 20% 阈值空间给当前活跃消息，避免频繁产出观察
- **向量索引：** 观察自动向量化，支持检索

**默认模型：** `google/gemini-2.5-flash`（可在配置中覆盖）

这完全替代了自建的规则截断方案（200字符/条拼接），摘要质量从"截断拼接"跃升到"结构化理解"。

### 3.4 Memory 注册位置

Mastra 支持两级 memory 注册：

| 注册位置 | 作用范围 | 优先级 |
|---------|---------|--------|
| `new Mastra({ memory: {} })` | 框架级，所有 Agent 共享 | 低（可被 Agent 级覆盖） |
| `new Agent({ memory })` | Agent 级，仅该 Agent 使用 | 高 |

当前 Vico 所有 Agent 使用相同 Memory 配置，因此适合注册在框架级。升级后从 Agent 级移除，统一在 `mastra.ts` 管理。

---

## 四、配置变更

### 4.1 memory-setup.ts

```typescript
// Before
new Memory({
  storage: getStorage(),
  options: { lastMessages: 10 },
});

// After
new Memory({
  storage: getStorage(),
  options: {
    lastMessages: 20,
    workingMemory: {
      enabled: true,
      template: `# 用户信息\n- **称呼**: \n...`,
    },
    semanticRecall: {
      topK: 5,
      messageRange: { before: 2, after: 2 },
    },
    observationalMemory: true,
  },
});
```

### 4.2 mastra.ts

```typescript
// Before
new Mastra({ agents, storage, observability });

// After
new Mastra({ agents, storage, memory: { memory: getMemory() }, observability });
```

### 4.3 chat.ts

```typescript
// Before: onComplete 中手动调用自建 WorkingMemory 提取
onComplete: async (fullText) => {
  await workingMemory.extractAndStore(model, tenantId, userId, messages);
};

// After: 空操作，全部由 Mastra processor pipeline 自动管理
onComplete: async () => {};
```

---

## 五、数据迁移

### 5.1 迁移策略

| 源 | 目标 | 策略 |
|----|------|------|
| `memory_entries` type='working' | Mastra WorkingMemory storage | 按 tenant+user 分组，合并格式化为 Markdown 模板风格，通过 Memory API 写入 |
| `memory_entries` type='observation' | Mastra OM storage | 跳过。自建规则摘要质量低，Mastra 新 conversation 会重新生成高质量 LLM 摘要 |
| 其他 type (fact/preference/summary/decision) | — | 保留在 `memory_entries` 表，不迁移。后续评估是否需要 |

### 5.2 迁移时机

服务启动时自动执行迁移脚本 `migrateMemoryEntries()`。迁移是幂等的 — 已迁移的条目会被删除，重复启动不会重复迁移。

### 5.3 回退策略

- `memory_entries` 表保留不删除，迁移只做 `DELETE` 已迁移条目
- 如需回退，可通过 git 恢复自建代码，`memory_entries` 表中未迁移的条目继续可用
- Mastra 原生 WorkingMemory 数据可通过 `memory.getMemoryStore()` API 反向导出

---

## 六、边界与约束

### 6.1 保留不变

- `LibSQLStore` / `LibSQLVector` — 继续使用
- `ModelRouterEmbeddingModel` — embedder 方案不变
- `conversation-manager.ts` — `listThreads`/`getThreadById`/`recall` API 不变
- Chat SSE 格式 — 前端无感
- `memory_entries` 表定义 — 保留 schema，不删除表

### 6.2 删除

- `agent/memory/working-memory.ts` + tests
- `agent/memory/observational-memory.ts` + tests
- `chat.ts` 中对自建 WorkingMemory 的 import 和调用
- `main.agent.ts` / `agent-proxy.agent.ts` 中 `memory: getMemory()`

### 6.3 已知限制

- **Embedder 仅支持 API 模式** — `config.rag.embedder = 'local'` 路径未实现。后续可通过 `@mastra/core` 的 `EmbeddingModelV2` 协议接入 Transformers.js
- **OM 默认模型为 gemini** — 如果 Vico 未配置 Google API key 或网络不通，需覆盖为其他 provider。可在 `observationalMemory` 配置中指定 `model: 'openai/gpt-4o'`
- **SemanticRecall 消耗 embedding quota** — 每次请求做一次向量检索，在 OpenAI embedding 计费模式下增加少量开销

---

## 七、测试要点

| 场景 | 验证方式 |
|------|---------|
| WorkingMemory — agent 自动存储偏好 | 发送"我喜欢简洁回复"，新对话问"我的偏好是什么" |
| WorkingMemory — 跨对话持久化 | 不同 thread 中 agent 都能获取用户画像 |
| SemanticRecall — 跨对话回忆 | 对话 A 讨论过主题 X，对话 B 中 agent 能引用 |
| OM — LLM 摘要触发 | 同 thread 发送 30+ 条长消息，检查 Mastra Storage 中 observation 生成 |
| OM — 摘要上下文注入 | 长对话后新消息，agent 引用历史摘要内容 |
| 回归 — SSE 流式兼容 | 前端聊天功能正常，`text_delta` 事件格式不变 |
| 回归 — conversation-manager | 对话列表/详情/消息查询正常 |

---

## 八、残余风险

### 🔴 风险 1：WorkingMemory 行为差异 — 可能倒退

| | 当前自建方案 | Mastra 原生方案 |
|---|-------------|----------------|
| **提取方式** | 独立 LLM 调用（`generateObject` + Zod），强制提取 | Agent 自觉调用 `updateWorkingMemory` tool |
| **可靠性** | 高 — 每次对话必定执行 | 取决于模型指令遵循能力 |
| **弱模型表现** | 可靠 | 可能根本不调用 tool |

**缓解：** Mastra 的 `updateWorkingMemory` tool instruction 中有 `"IMPORTANT: You MUST call updateWorkingMemory in every response..."` 的强制指令，对 GPT-4/Claude 级别模型有效。如果实际使用中弱模型不调用，可考虑在 agent `instructions` 中追加更强的 working memory 调用要求。

### 🔴 风险 2：OM 默认模型为 Gemini

**缓解：** 计划中已显式覆盖为环境中可用的模型（见 Task 1 配置）。

### 🟡 风险 3：迁移脚本 API 不确定性

部分 Mastra Memory 内部 API（`getMemoryStore().getWorkingMemory()` / `setWorkingMemory()`）未在公开文档中确认。**缓解：** 实施时先验证 API，若不可用则通过 Mastra 公开的 `memory.recall()` / `memory.saveThread()` 等 API 替代迁移路径。

### 🟡 风险 4：Embedder 本地模式（未涉及）

本升级不处理 embedder 本地模式支持，后续需单独规划。

---

## 九、实施计划

详见 `docs/superpowers/plans/2026-06-15-mastra-memory-全面升级.md`

| Task | 内容 | 文件 |
|------|------|------|
| 1 | 配置 3 个 Mastra 原生 processor | `memory-setup.ts` |
| 2 | Memory 传入 Mastra 构造函数 | `mastra.ts` |
| 3 | 移除 Agent 级 memory 配置 | `main.agent.ts`, `agent-proxy.agent.ts` |
| 4 | 清理 chat.ts 自建提取调用 | `chat.ts` |
| 5 | 删除自建实现文件 | `working-memory.ts`, `observational-memory.ts`, tests |
| 6 | 数据迁移脚本 | `migrate-memory-entries.ts` (新建) |
| 7 | 端到端验证 | 全栈 |
