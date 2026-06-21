# Mastra Working Memory 事实提取与更新完整流程

> 回答核心问题：Working Memory 如何从对话中提取事实、如何更新、以及完整的数据流转。

## 1. 概览

Working Memory（工作记忆）是 Mastra 三层记忆系统中的**短期可变层**，用于在对话过程中跟踪用户信息、偏好和上下文。它通过一个名为 `updateWorkingMemory`（或 `setWorkingMemory`）的 **Agent 工具** 来更新，而非自动提取。

```
                    ┌──────────────────────┐
                    │    Agent Loop         │
                    │                       │
                    │  ┌─────────────────┐  │
                    │  │ System Prompt   │  │
                    │  │ (含 WM 指令)     │  │
                    │  └────────┬────────┘  │
                    │           │           │
                    │           ▼           │
                    │  ┌─────────────────┐  │
                    │  │ LLM 决定更新 WM  │  │
                    │  └────────┬────────┘  │
                    │           │           │
                    │           ▼           │
                    │  ┌─────────────────┐  │
                    │  │ 调用 updateWM   │  │
                    │  │ tool            │  │
                    │  └────────┬────────┘  │
                    │           │           │
                    │           ▼           │
                    │  ┌─────────────────┐  │
                    │  │ deepMerge /     │  │
                    │  │ 全量替换         │  │
                    │  └────────┬────────┘  │
                    │           │           │
                    │           ▼           │
                    │  ┌─────────────────┐  │
                    │  │ 持久化到存储      │  │
                    │  └─────────────────┘  │
                    │                       │
                    │  下一次 Loop 迭代       │
                    │  → 系统提示词已含新 WM  │
                    └──────────────────────┘
```

**关键设计**：Mastra 的 Working Memory **不是自动提取**的。Agent 在系统提示词的引导下，**自主决定**何时调用 `updateWorkingMemory` 工具来存储事实。

---

## 2. 配置类型

### 2.1 三种模式

文件：`packages/core/src/memory/types.ts` (175-224)

```typescript
type WorkingMemoryConfig =
  | TemplateWorkingMemory      // 模板模式（Markdown 模板）
  | SchemaWorkingMemory        // Schema 模式（JSON Schema）
  | WorkingMemoryNone;         // 仅启用工具，无预定义结构

// 基础属性
type BaseWorkingMemory = {
  enabled: boolean;
  scope?: 'thread' | 'resource';    // 作用域，默认 resource
  useStateSignals?: boolean;         // 是否用状态信号传输，默认 false
};

// 模板模式
type TemplateWorkingMemory = BaseWorkingMemory & {
  template: string;                 // Markdown 模板
  version?: 'stable' | 'vnext';     // stable: 全量替换; vnext: 搜索替换
};

// Schema 模式
type SchemaWorkingMemory = BaseWorkingMemory & {
  schema: ZodSchema | JsonSchema;   // 结构化 schema
};
```

### 2.2 作用域

| 值 | 存储位置 | 可见性 |
|------|------|------|
| `resource`（默认） | `mastra_resources.working_memory` | 同 resource 的所有线程共享 |
| `thread` | `mastra_threads.metadata.working_memory` | 仅当前线程 |

### 2.3 默认模板

文件：`packages/memory/src/index.ts` (1667-1678)

```markdown
# User Information
- **First Name**: 
- **Last Name**: 
- **Location**: 
- **Occupation**: 
- **Interests**: 
- **Goals**: 
- **Events**: 
- **Facts**: 
- **Projects**: 
```

---

## 3. 初始化流程

### 3.1 Memory 构造时

文件：`packages/memory/src/index.ts` (256-310)

```typescript
constructor(config: MemoryConstructorConfig = {}) {
  const mergedConfig = this.getMergedThreadConfig({
    workingMemory: config.options?.workingMemory || {
      enabled: false,
      template: this.defaultWorkingMemoryTemplate,
    },
    // ...
  });
  this.threadConfig = mergedConfig;
  // 不在此处创建任何内容，延迟到首次访问
}
```

**不创建任何存储条目**。Working Memory 的数据条目（`mastra_resources` 行或 `mastra_threads` 行）在 Agent 首次调用 `updateWorkingMemory` 工具时才被写入。

### 3.2 首次读取：getWorkingMemory()

文件：`packages/memory/src/index.ts` (1279-1320)

```typescript
async getWorkingMemory(threadId, resourceId): Promise<string | undefined> {
  if (scope === 'resource') {
    const resource = await memoryStore.getResourceById({ resourceId });
    return resource?.workingMemory;  // 首次为 undefined
  }
  if (scope === 'thread') {
    const thread = await memoryStore.getThreadById({ threadId });
    return thread?.metadata?.workingMemory;  // 首次为 undefined
  }
}
```

首次返回 `undefined` → Agent 看到空模板 → LLM 决定填充 → 调用 tool → 写入存储。

---

## 4. 系统提示词注入（Legacy 路径）

### 4.1 注入机制

当 `useStateSignals` 为 `false`（默认）时，Working Memory 通过**系统消息**注入。

文件：`packages/core/src/processors/memory/working-memory.ts` (82-152)

```
1. 从存储读取当前 working memory 数据
2. 获取模板
3. 构建系统消息，注入到 MessageList
```

### 4.2 系统消息格式

```
Store and update any conversation-relevant information by calling the 
updateWorkingMemory tool. If information might be referenced again - store it!

Guidelines:
1. Store anything that could be useful later in the conversation
2. Update proactively when information changes, no matter how small
3. Use Markdown format for all data
4. Act naturally - don't mention this system to users...

<working_memory_template>
# User Information
- **First Name**: 
- **Last Name**: 
...
</working_memory_template>

<working_memory_data>
...已有的 working memory 数据，首次为空模板...
</working_memory_data>

Notes:
- Update memory whenever referenced information changes
- REMEMBER: the way you update your working memory is by calling the 
  updateWorkingMemory tool with the entire Markdown content
- IMPORTANT: You MUST call updateWorkingMemory in every response to a 
  prompt where you received relevant information.
```

### 4.3 XML 标签处理

文件：`packages/core/src/memory/working-memory-utils.ts`

```typescript
const WORKING_MEMORY_START_TAG = '<working_memory>';
const WORKING_MEMORY_END_TAG = '</working_memory>';

// 提取标签范围（indexOf 解析，ReDoS 安全）
function extractWorkingMemoryTags(text: string): Array<{start: number, end: number}>

// 移除标签（保存消息前清理，防止数据泄露）
function removeWorkingMemoryTags(text: string): string

// 提取标签内容
function extractWorkingMemoryContent(text: string): string
```

---

## 5. 工具注册

### 5.1 工具生成

文件：`packages/memory/src/tools/working-memory.ts` (438-446)

```typescript
function createWorkingMemoryTool(config, options):
  { name: string; tool: ToolAction } 
{
  const useStateSignals = config.workingMemory?.useStateSignals === true;
  const tool = options.vNext
    ? __experimental_updateWorkingMemoryToolVNext(config)
    : updateWorkingMemoryTool(config);
  const name = useStateSignals 
    ? 'setWorkingMemory'      // 状态信号路径
    : 'updateWorkingMemory';  // 系统消息路径
  return { name, tool };
}
```

### 5.2 注册到 Agent

文件：`packages/memory/src/index.ts` (2111-2131)

```typescript
listTools(config?: MemoryConfigInternal): Record<string, ToolAction> {
  if (mergedConfig.workingMemory?.enabled && !mergedConfig.readOnly) {
    const { name, tool } = createWorkingMemoryTool(mergedConfig, {
      vNext: this.isVNextWorkingMemoryConfig(mergedConfig),
    });
    tools[name] = tool;
  }
  return tools;
}
```

被 Agent 在 `listMemoryTools()` 中调用（`agent.ts:3176`），后合并到 `allTools`（`agent.ts:5605-5607`）。

---

## 6. 工具执行：事实提取与更新

### 6.1 模板模式（全量替换）

文件：`packages/memory/src/tools/working-memory.ts` (95-310)

```
Tool 被 LLM 调用 { memory: "# User Information\n- **Name**: John\n..." }
  │
  ├── 1. 从 context 提取 threadId, resourceId
  │
  ├── 2. 获取 memory 实例
  │
  ├── 3. 确保线程存在（首次则创建）
  │
  ├── 4. 读取现有 working memory
  │      └── getWorkingMemory(threadId, resourceId)
  │
  ├── 5. 全量替换检查（防退化保护）
  │      ├── LLM 传入了完整 Markdown 字符串
  │      └── ⚠️ 如果新内容等于空模板 且 旧内容非空 → 拒绝更新！
  │          （防止 LLM 用空模板覆盖已有数据）
  │
  └── 6. 调用 memory.updateWorkingMemory()
```

### 6.2 Schema 模式（深度合并）

```
Tool 被 LLM 调用 { memory: { preferences: { language: "zh" } } }
  │
  ├── 1-3. 同上
  │
  ├── 4. 读取现有 working memory（JSON 字符串）
  │      └── 解析为对象
  │
  ├── 5. deepMergeWorkingMemory(existing, update)
  │      ├── update.preferences = { language: "zh" }
  │      ├── existing 中有 preferences.location = "Shanghai"
  │      └── 合并结果: { preferences: { language: "zh", location: "Shanghai" } }
  │
  └── 6. 调用 memory.updateWorkingMemory()
```

### 6.3 deepMergeWorkingMemory 精确逻辑

文件：`packages/memory/src/tools/working-memory.ts` (21-68)

```typescript
function deepMergeWorkingMemory(
  existing: Record<string, unknown> | null | undefined,
  update: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  // 规则 1: update 为空 → 保留 existing
  if (!update || Object.keys(update).length === 0) {
    return existing ? { ...existing } : {};
  }
  
  // 规则 2: existing 为空/非对象 → 完全替换
  if (!existing || typeof existing !== 'object') {
    return update;
  }
  
  // 规则 3: 逐字段合并
  const result = { ...existing };
  for (const [key, updateValue] of Object.entries(update)) {
    if (updateValue === null) {
      // NULL → 删除该字段
      delete result[key];
    } else if (Array.isArray(updateValue)) {
      // 数组 → 完全替换（不逐元素合并）
      result[key] = updateValue;
    } else if (isPlainObject(updateValue) && isPlainObject(result[key])) {
      // 两个都是普通对象 → 递归合并
      result[key] = deepMergeWorkingMemory(result[key], updateValue);
    } else {
      // 原始值 / 新字段 / 类型不匹配 → 覆盖
      result[key] = updateValue;
    }
  }
  return result;
}
```

**关键语义**：
| 场景 | 行为 |
|------|------|
| `update.value = null` | **删除**属性 |
| `update.list = [1,2]` | **完全替换**数组（不追加） |
| `update.prefs.lang = 'zh'` | 只改 `lang`，保留 `prefs` 下其他字段 |
| `existing` 不存在 | **完全替换** |
| `update` 为空 `{}` | **保留** existing |

---

## 7. 持久化（Mutex 保护）

### 7.1 updateWorkingMemory()

文件：`packages/memory/src/index.ts` (717-795)

```typescript
async updateWorkingMemory({ threadId, resourceId, workingMemory }) {
  // Mutex 锁：按 resource_id 或 thread_id 为键
  const mutexKey = scope === 'resource' 
    ? `resource-${resourceId}` 
    : `thread-${threadId}`;
  
  const release = await mutex.acquire();
  try {
    if (scope === 'resource') {
      await memoryStore.updateResource({ 
        resourceId, 
        workingMemory 
      });
    } else {
      await memoryStore.updateThread({ 
        id: threadId, 
        metadata: { ...thread.metadata, workingMemory } 
      });
    }
  } finally {
    release();
  }
}
```

### 7.2 互斥锁保证

```
Per-(resource/thread) async-mutex
  ├── 同一 resource 的并发 updateWorkingMemory 调用被序列化
  ├── 不同 resource 的调用可并行
  └── 防止两个 LLM 响应同时更新导致写冲突
```

### 7.3 跨作用域同步

`saveThread()` 和 `updateThread()` 方法中（`index.ts:588-633`），如果线程的 `metadata.workingMemory` 存在，会同步到 `mastra_resources.working_memory`。这意味着即使配置为 thread 作用域，也存在一条路径将数据写入 resource 级别。

---

## 8. VNext：搜索替换模式

### 8.1 动机

VNext（version: 'vnext'）模式通过**搜索替换**而非全量替换来更新：
- 减少 LLM 输出 token（只需输出变更部分）
- 允许增量编辑

### 8.2 三种操作

文件：`packages/memory/src/tools/working-memory.ts` (312-421)

| 操作 | 含义 | 参数 |
|------|------|------|
| `append-new-memory` | 追加到末尾 | `newMemory` |
| `clarify-existing-memory` | 替换指定行 | `searchString`, `newMemory` |
| `replace-irrelevant-memory` | 同上但限 thread 作用域 | `searchString`, `newMemory` |

### 8.3 执行流程

文件：`packages/memory/src/index.ts` (801-946)

```
append-new-memory:
  ├── 检查新内容是否重复（等于已有或等于模板）→ 跳过
  └── 追加到 working memory 末尾

clarify-existing-memory / replace-irrelevant-memory:
  ├── 在 working memory 中查找 searchString
  ├── 找到 → 替换为该行 newMemory
  └── 未找到 → 降级为 append-new-memory
```

---

## 9. 状态信号路径（替代方案）

### 9.1 何时使用

当 `useStateSignals: true` 时，Working Memory 不通过系统消息注入，而是通过**状态信号**实时传输。

### 9.2 WorkingMemoryStateProcessor

文件：`packages/memory/src/processors/working-memory-state/processor.ts` (1-202)

```
每次状态变化
  │
  ├── 1. 获取模板 + 当前数据
  ├── 2. 计算 SHA-256 cacheKey (format + '\0' + data)
  ├── 3. 去重：cacheKey 未变 → 不发送
  │
  ├── 4. 决定传输模式:
  │   ├── 无历史快照 → Snapshot (完整文本)
  │   ├── 有快照 + Markdown 格式 → Delta (unified-diff)
  │   └── 有快照 + JSON 格式 → Snapshot (delta 仅支持 markdown)
  │
  └── 5. 发送状态信号
```

### 9.3 与系统消息路径的对比

| 特征 | 系统消息路径 | 状态信号路径 |
|------|-----------|-----------|
| 注入方式 | 每次 LLM 调用的系统消息 | 仅变更时发送信号 |
| 数据量 | 每次完整传输 | 支持增量 delta |
| 去重 | 无 | SHA-256 缓存键 |
| 工具名 | `updateWorkingMemory` | `setWorkingMemory` |
| 系统消息 | 包含 WM 数据 | `getSystemMessage()` 返回 null |

---

## 10. 保存时的清理

### 10.1 防止数据泄露

文件：`packages/memory/src/index.ts` (1227-1270)

`saveMessages()` 在保存消息前执行 `updateMessageToHideWorkingMemoryV2()`：

```
每条消息:
  ├── 移除 <working_memory> XML 标签
  ├── 移除 updateWorkingMemory/setWorkingMemory 工具调用 parts
  └── 如果所有 parts 被移除且无文本内容 → 丢弃整条消息
```

这确保存储的消息历史不会包含 WM 系统指令和工具调用痕迹。

---

## 11. Agent Loop 中的完整时序

```
用户: "我叫张三，在上海工作"
  │
  ▼
┌─ Agent Loop 第 1 步 ─────────────────────────────┐
│                                                   │
│  1. Input Processors                              │
│     └── WorkingMemory.processInput()              │
│         ├── getWorkingMemory() → undefined        │
│         ├── 注入系统消息（含空模板 + 指令）         │
│         └── LLM 看到: "你必须用 updateWorkingMemory │
│             存储信息"                              │
│                                                   │
│  2. LLM 调用                                      │
│     ├── 系统消息含 WM 指令                         │
│     └── LLM 决定: 需要存储用户信息                 │
│                                                   │
│  3. Tool 调用: updateWorkingMemory                │
│     { memory: "# User Information\n               │
│                - **Name**: 张三\n                  │
│                - **Location**: 上海" }             │
│     │                                             │
│     └── execute():                                │
│         ├── getWorkingMemory() → undefined         │
│         ├── 全量替换 (模板模式)                     │
│         ├── updateWorkingMemory({                 │
│         │     workingMemory: "...Name: 张三..."    │
│         │   })                                    │
│         │   └── mutex.acquire()                   │
│         │   └── memoryStore.updateResource(...)     │
│         │   └── mutex.release()                   │
│         └── 返回成功                               │
│                                                   │
│  4. LLM 看到 tool 结果，继续生成回复               │
└───────────────────────────────────────────────────┘
  │
  ▼
用户: "我搬到了北京"
  │
  ▼
┌─ Agent Loop 第 1 步 ─────────────────────────────┐
│                                                   │
│  1. Input Processors                              │
│     └── WorkingMemory.processInput()              │
│         ├── getWorkingMemory() → "...Name: 张三    │
│         │                        Location: 上海"  │
│         └── 注入含旧数据的系统消息                   │
│                                                   │
│  2. LLM 看到:                                     │
│     - WM 模板 + 旧数据 (Name: 张三, Location: 上海)  │
│     - 用户新消息: "我搬到了北京"                     │
│     └── LLM 决定: 需要更新 Location                │
│                                                   │
│  3. Tool 调用: updateWorkingMemory                 │
│     { memory: "...Location: 北京..." }             │
│     │                                             │
│     └── execute():                                │
│         ├── getWorkingMemory() → 旧数据             │
│         ├── 全量替换为新 Markdown                    │
│         ├── 防退化检查:                              │
│         │   新内容 ≠ 空模板 → 通过                  │
│         └── updateWorkingMemory(...)               │
│                                                   │
│  4. Post-response (agent.ts:6559-6564)            │
│     └── 检测到使用了 WM tool                        │
│         └── 重新加载 thread（获取最新 WM）           │
└───────────────────────────────────────────────────┘
```

---

## 12. 关键设计决策

| 决策 | 实现 | 理由 |
|------|------|------|
| **LLM 自主更新** | 不自动提取，由 LLM 调用 tool | 依赖 LLM 判断力 |
| **全量替换（模板模式）** | LLM 每次传入完整 Markdown | 简单可靠 |
| **深度合并（Schema 模式）** | null 删除、数组替换、对象递归 | JSON 结构精确控制 |
| **防退化保护** | 拒绝用空模板覆盖已有数据 | 防止 LLM 误操作 |
| **Mutex 锁** | per-resource/thread async-mutex | 并发安全 |
| **保存前清理** | 移除 WM 标签和工具调用 | 防止数据泄露 |
| **跨作用域同步** | thread WM → resource WM | 数据传播 |
| **两条注入路径** | 系统消息 vs 状态信号 | 灵活的上下文管理 |
| **Fire-and-forget 不适用** | WM 更新是同步等待的 | 需要确保 Agent 看到最新状态 |

---

## 13. 与 SemanticRecall 的互动

```
                     Working Memory           SemanticRecall
                     ─────────────           ─────────────
目的:                 跟踪用户事实             检索历史消息
更新方式:             LLM 主动调用 tool        保存时自动嵌入
更新时机:             LLM 决定的任意时刻       每次消息保存
数据结构:             Markdown / JSON          向量 (float32[])
查询方式:             系统提示词注入             向量相似度搜索
生命周期:             对话级 (thread/resource)  持久（可跨 thread）
```

两者互补：Working Memory 是**精确的事实存储**，SemanticRecall 是**模糊的语义搜索**。

---

## 14. 关键文件索引

| 组件 | 文件 | 行号 |
|------|------|------|
| WM 配置类型 | `packages/core/src/memory/types.ts` | 175-224 |
| WM XML 标签工具 | `packages/core/src/memory/working-memory-utils.ts` | 1-153 |
| WM 系统消息处理器 | `packages/core/src/processors/memory/working-memory.ts` | 1-282 |
| deepMergeWorkingMemory | `packages/memory/src/tools/working-memory.ts` | 21-68 |
| updateWorkingMemoryTool | `packages/memory/src/tools/working-memory.ts` | 95-310 |
| VNext 工具 | `packages/memory/src/tools/working-memory.ts` | 312-421 |
| createWorkingMemoryTool | `packages/memory/src/tools/working-memory.ts` | 438-446 |
| Memory.updateWorkingMemory | `packages/memory/src/index.ts` | 717-795 |
| Memory._updateWorkingMemoryVNext | `packages/memory/src/index.ts` | 801-946 |
| Memory.getWorkingMemory | `packages/memory/src/index.ts` | 1279-1320 |
| Memory.getWorkingMemoryTemplate | `packages/memory/src/index.ts` | 1329-1365 |
| Memory.getSystemMessage | `packages/memory/src/index.ts` | 1367-1773 |
| Memory.getContext (全组装) | `packages/memory/src/index.ts` | 1431-1562 |
| Memory.listTools (注册 WM tool) | `packages/memory/src/index.ts` | 2111-2131 |
| Memory.saveMessages 清理 | `packages/memory/src/index.ts` | 1227-1270 |
| 默认 WM 模板 | `packages/memory/src/index.ts` | 1667-1678 |
| WM State Processor | `packages/memory/src/processors/working-memory-state/processor.ts` | 1-202 |
| Agent listMemoryTools | `packages/core/src/agent/agent.ts` | 3160-3209 |
| Agent post-WM thread 刷新 | `packages/core/src/agent/agent.ts` | 6559-6564 |
| MastraMem.getInputProcessors | `packages/core/src/memory/memory.ts` | 700-758 |
