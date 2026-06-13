# Chat Menu Design

## 概述

在侧边栏新增「Chat」菜单（位于 Dashboard 和 Agents 之间），提供与 Agent 实时对话的聊天界面。同时修复 `/api/v1/chat` 端点，使其使用用户选择的 Agent 而非硬编码的 `mainAgent`。

## 1. 服务端：提取 Chat 核心逻辑

### 目标
将 `packages/server/src/api/chat.ts` 中的聊天主逻辑抽取到独立模块，使路由层保持薄，同时修复 Agent 选择问题。

### 文件结构
```
packages/server/src/
├── api/chat.ts           → 薄路由层（仅解析参数、调用核心逻辑、返回响应）
└── chat/
    └── chat.ts           → 核心聊天逻辑
```

### 关键修复
- `POST /api/v1/chat` 当前接受 `agentId` 但始终使用 `mastra.getAgent('mainAgent')`
- 修复后：根据 `agentId` 查找对应的 Agent（需获取 Agent 配置中的 model 等信息），使用该 Agent 进行对话
- 如果 `agentId` 对应的 Agent 不存在，返回 400 错误

## 2. 前端：新增 Chat 页面

### 路由
- 新增 `/chat` 路由，受 ProtectedRoute 保护
- 可选：`/chat/:conversationId` 路由，加载特定对话

### 布局：ChatGPT 风格分栏

```
┌─────────────────┬──────────────────────────────┐
│  左侧面板 (w-80)  │  右侧 (flex-1)                │
│                  │                              │
│  Agent 选择器    │  消息列表                      │
│  [下拉框]        │  ┌─────────────────────────┐  │
│                  │  │ 用户消息                  │  │
│  [+ 新对话]      │  │ AI 回复（流式渲染）         │  │
│                  │  └─────────────────────────┘  │
│  对话列表        │                              │
│  ┌─────────────┐ │  输入区域                      │
│  │ 对话 1       │ │  ┌─────────────────────────┐  │
│  │ 对话 2       │ │  │ Textarea + Send 按钮     │  │
│  │ 对话 3       │ │  └─────────────────────────┘  │
│  └─────────────┘ │                              │
└─────────────────┴──────────────────────────────┘
```

### 组件树

```
ChatPage (顶层，获取 agents 列表)
├── ChatSidebar (左侧面板)
│   ├── Agent 选择器 (下拉框，选择后可开始新对话)
│   ├── "新建对话" 按钮
│   └── 对话列表 (可滚动，选中高亮)
└── ChatWindow (右侧聊天区域)
    ├── 对话标题栏 (显示当前 Agent 名称)
    ├── 消息列表 (ScrollArea，复用 MessageBubble)
    └── ChatInput (textarea + Enter 发送)
```

### 状态覆盖

| 状态 | 表现 |
|------|------|
| 加载中 | 侧边栏 Skeleton + 聊天区 Skeleton |
| 空态 | "选择一个 Agent 并开始对话" 提示 |
| 错误态 | 发送失败时 Toast 提示 |
| 流式响应 | 实时 SSE 文本渲染（逐字显示） |
| 对话列表空 | "暂无对话" 空状态提示 |

### 数据流

1. 页面加载 → `GET /api/v1/agents` 获取 Agent 列表
2. 选择 Agent → 自动创建新对话（本地生成 conversationId）
3. 发送消息 → `POST /api/v1/chat { agentId, message, conversationId }` → SSE 流式响应
4. 切换对话 → 加载对应 conversationId 的消息历史
5. 加载历史对话列表 → `GET /api/v1/conversations`

### 导航修改

侧边栏 `navItems` 顺序变为：

Dashboard → **Chat** → Agents → Agent Teams → Skills → Knowledge → Conversations → Settings

## 3. 国际化

需要新增的 i18n key（`sidebar.json`）：
- `chat`: "Chat"

## 4. 不涉及

- 不修改现有 `/conversations` 和 `/conversations/:id` 页面
- 不修改 Teams 的聊天端点
- 不新增数据库表
