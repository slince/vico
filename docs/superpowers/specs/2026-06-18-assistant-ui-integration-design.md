# Assistant UI 集成设计

## 目标

将 `@assistant-ui/react` 引入 Vico 前端，全面替换现有自定义聊天 UI（ChatWindow、MessageBubble、Sidebar），通过 AI SDK 协议适配使 Mastra 后端与 Assistant UI 无缝对接，并为所有 Agent 工具提供可渐进增强的定制 UI 渲染。

## 动机

- 当前前端 `Chat.tsx` 自行解析 SSE，`tool_call` / `tool_result` 事件被丢弃，工具调用不可见
- `MessageBubble` 纯文本 Markdown 渲染，工具结果混在文本中，体验差
- 手写消息状态管理、流式渲染、滚动等基础能力，维护成本高
- Assistant UI 提供 Thread、Composer、Markdown、ToolUI 等开箱即用组件，可删除大量自研代码

## 方案：AI SDK 协议适配（方案 B）

### 架构

```
浏览器                                 服务端
┌─────────────────────────┐    ┌─────────────────────────┐
│ Assistant UI Thread     │    │ /api/v1/chat            │
│  ├─ ToolUIs (天气卡片等) │    │  ├─ 现有聊天逻辑 (不变)    │
│  └─ MarkdownText        │    │  └─ AI SDK DataStream    │
│                         │    │     Mastra output         │
│  RuntimeProvider         │    │     → AI SDK UI stream    │
│  └─ useChat (ai-sdk)    │───▶│       format              │
│                         │    │                          │
│  Sidebar 保留并重建      │    │ /api/v1/teams/:id/chat   │
│                         │    │  └─ 同上                   │
└─────────────────────────┘    └─────────────────────────┘
```

**核心思路**：服务端新增 AI SDK 兼容端点，前端用 `@assistant-ui/react-ai-sdk` 直接对接，无需自定义 Runtime。

### 涉及包

| 包 | 用途 |
|---|------|
| `@assistant-ui/react` | Thread、Composer、Message 等核心组件 |
| `@assistant-ui/react-ai-sdk` | useChat 桥接、RuntimeProvider、makeAssistantToolUI |
| `@assistant-ui/react-markdown` | AI 消息 Markdown 渲染（替代 react-markdown） |

项目中已存在的 `ai` + `@ai-sdk/react` 是前置依赖。

### 服务端改动

#### 新增：`packages/server/src/agent/ai-sdk-stream.ts`

将 Mastra 输出转换为 AI SDK UI stream format：

- 消费 Mastra `textStream` → AI SDK `text-delta` chunk
- 消费 Mastra `toolCalls` Promise → AI SDK `tool-call` chunk
- 消费 Mastra `toolResults` Promise → AI SDK `tool-result` chunk
- 最后写入 `finish` chunk（含 usage）
- 使用 `ai` 包自带的 `DataStreamWriter` 保证格式正确

#### 路由层：`packages/server/src/api/chat.ts`

新增端点，内部逻辑复用现有 Mastra pipeline，仅输出格式改为 AI SDK stream。旧端点保留作为过渡。

### 前端改动

#### 重写：`Chat.tsx`

```tsx
// 核心结构
<RuntimeProvider runtime={runtime}>
  <div className="flex h-[calc(100vh-0px)] -m-6">
    <ChatSidebar />
    <Thread />
  </div>
</RuntimeProvider>
```

- 用 `useChat` 替代手写 `streamChat` + `AbortController`
- `Thread` 替代 `ChatWindow` + 手写消息列表 + 滚动逻辑
- 删除 `ChatSkeleton`、简化或删除 `MessageBubble`

#### 新增：`packages/web/src/pages/chat/ToolUIs/`

每个工具一个文件，用 `makeAssistantToolUI` 定义专属渲染：

| 文件 | 对应工具 | 渲染内容 |
|------|---------|---------|
| `weather-ui.tsx` | `get-weather` | 温度、湿度、风速、天气状况卡片 |
| `exec-ui.tsx` | `mastra_workspace_execute_command` | 审批卡片（批准/拒绝）+ 执行结果 |

**未定义 ToolUI 的工具**：Assistant UI 内置默认通用卡片（工具名 + 参数 JSON + 结果），不会报错或丢弃，可渐进增强。

#### 重写：`ChatSidebar.tsx`

保留现有侧边栏结构（Agent 列表 + 对话列表），但需要适配新的数据流（`useChat` 的 threadId 管理方式）。布局和交互逻辑基本不变。

#### 删除/简化

| 文件 | 处理 |
|------|------|
| `ChatWindow.tsx` | 删除（Thread 替代） |
| `ChatInput.tsx` | 删除（Composer 替代） |
| `MessageBubble.tsx` | 删除（AssistantMessage 替代） |
| `ChatSkeleton.tsx` | 删除（Thread 内置 loading） |
| `useAgentChat.ts` | 删除或简化为 useChat 封装 |

### 数据流

#### 发送消息

```
用户输入 → Thread/Composer → useChat.sendMessage()
  → POST /api/v1/chat → 后端 Mastra pipeline
  → AI SDK DataStream → SSE 流返回
  → useChat 自动更新 messages[]
    ├─ text content → Thread 渲染 Markdown
    ├─ tool-call → 匹配 ToolUI → 渲染自定义/默认卡片
    └─ tool-result → toolInvocation.state 更新
```

#### 工具调用生命周期

```
tool-call chunk → message.parts[toolInvocation].state = 'running'
  → Thread 渲染 loading 卡片
tool-result chunk → state = 'complete'
  → Thread 渲染结果
```

#### 审批流程

`mastra_workspace_execute_command` 工具调用时，`exec-ui.tsx` 在 `state === 'running'` 阶段渲染审批卡片。用户点击批准/拒绝后通过 `addToolOutput()` 回调完成审批。

### 状态覆盖

| 状态 | 处理方式 |
|------|---------|
| 初始空态 | Thread `empty` prop |
| 历史加载中 | Thread `loading` prop → Skeleton |
| 流式生成中 | Thread 内置 `message.isRunning` |
| 工具执行中 | ToolUI `state === 'running'` → loading 态 |
| 错误态 | `useChat.error` → Thread `error` prop |
| 网络中断 | `AbortError` → useChat 内部消化 |

### 迁移步骤

1. **新增服务端 AI SDK 端点** — `/api/v1/chat` 增加 AI SDK 格式响应（可通过 query param 或 Accept header 区分），旧格式保留
2. **前端引入 Assistant UI** — `RuntimeProvider` + `useChat` 接管数据流
3. **替换 UI 组件** — `Thread` + `Composer` 替换 `ChatWindow` + `ChatInput`
4. **添加工具 UI** — 先做 `weatherTool` 验证，再做 `exec`
5. **团队聊天迁移** — 同样模式应用到 `streamTeamChat`
6. **清理** — 删除旧组件、旧 hook

### 风险

- **审批流程兼容**：`approval_required` 事件不在 AI SDK 标准内，需通过 tool 粒度的交互来处理，可能需要调整后端审批逻辑
- **团队 Supervisor 模式**：`createNetworkSSEStream` 的 chunk 类型与 Mastra 直接输出略有差异，适配时需注意
- **包体积**：`@assistant-ui/react` 系列包会增加前端打包体积
