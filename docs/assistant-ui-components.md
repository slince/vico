# assistant-ui 组件体系文档

> 面向 AI 编程助手的参考文档，覆盖 `packages/web/src/components/assistant-ui/` 下全部 30 个文件。

---

## 一、架构概览

assistant-ui 组件是对 `@assistant-ui/react` 和 `@assistant-ui/react-markdown` 等底层 primitives 的高层封装，提供完整的聊天 UI 解决方案。组件间依赖关系如下：

```
thread.tsx (核心编排)
├── attachment.tsx (附件上传/预览)
├── markdown-text.tsx (Markdown 渲染)
│   ├── shiki-highlighter.tsx (代码高亮)
│   └── mermaid-diagram.tsx (Mermaid 图表)
├── reasoning.tsx (推理过程展示)
├── tool-fallback.tsx (未知工具 Fallback)
├── tool-group.tsx (工具调用分组)
├── tooltip-icon-button.tsx (带 Tooltip 的图标按钮)
├── message-timing.tsx (流式耗时统计)
└── quote.tsx (引用块/选区工具栏/输入框引用预览)

布局容器：
├── assistant-modal.tsx (弹窗式聊天)
├── assistant-sidebar.tsx (侧边栏式聊天)
├── thread-list.tsx (会话列表)
└── threadlist-sidebar.tsx (会话列表侧边栏)

独立组件（可直接使用）：
├── model-selector.tsx (模型选择器)
├── mcp-config.tsx (MCP 服务器配置)
├── context-display.tsx (上下文 Token 用量)
├── voice.tsx (语音控制 + WebGL 球体可视化)
├── composer-trigger-popover.tsx (Composer 触发弹窗)
├── directive-text.tsx (指令语法解析)
├── sources.tsx (来源引用)
├── file.tsx (文件展示)
├── diff-viewer.tsx (Diff 查看器)
├── dot-matrix.tsx (状态指示器)
├── number-roll.tsx (数字滚动动画)
├── badge.tsx (徽章)
├── accordion.tsx (手风琴)
├── select.tsx (选择器)
├── tabs.tsx (标签页)
└── context-display.tsx (Token 用量展示)
```

所有组件均使用 `"use client"` 指令，为 React Client Component。

---

## 二、核心聊天组件

### 2.1 thread.tsx — 聊天主线程

**文件**: `packages/web/src/components/assistant-ui/thread.tsx`  
**依赖**: `@assistant-ui/react` (ThreadPrimitive, MessagePrimitive, ComposerPrimitive, ActionBarPrimitive, BranchPickerPrimitive 等)  
**被依赖**: `assistant-modal.tsx`, `assistant-sidebar.tsx`, `Chat.tsx`

#### 导出

```tsx
export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

export type ThreadComponents = {
  AssistantMessage?: ComponentType;        // 替换整个 AI 消息区域
  Welcome?: ComponentType;                 // 替换欢迎界面
  ToolFallback?: ToolCallMessagePartComponent;  // 替换未知工具 Fallback
  ToolGroup?: ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>;
  ReasoningGroup?: ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>;
};

export type ThreadProps = { components?: ThreadComponents };

export const Thread: FC<ThreadProps>;
```

#### 核心逻辑

- **`isNewChatView`**: 判断是否为新会话（`messages.length === 0 && !isLoading`），新会话时 Composer 居中显示，Welcome 组件替换消息列表
- **`groupPartByType`**: 将 Part 按类型分组合并：
  - `reasoning` → `"group-chainOfThought"` + `"group-reasoning"` 组
  - `"tool-call"` → `"group-chainOfThought"` + `"group-tool"` 组
  - `"standalone-tool-call"` → 不分组
- **`ThreadMessage`**: 根据 role 分发 → `EditComposer`（编辑中）/ `UserMessage` / `AssistantMessage`
- **Part 类型分发**: `text` → `MarkdownText`, `reasoning` → `Reasoning`, `tool-call` → `toolUI ?? ToolFallback`, `data` → `dataRendererUI`, `indicator` → 闪烁指示点

#### 内部组件

| 子组件 | 职责 |
|--------|------|
| `ThreadRoot` | 根容器，CSS 变量(--thread-max-width, --composer-bg, --composer-radius, --composer-padding) |
| `ThreadWelcome` | 欢迎语 "How can I help you today?" |
| `ThreadSuggestions` | 建议列表（`SuggestionPrimitive.Trigger send`） |
| `Composer` | 输入框 + 附件拖放区 + 发送/取消/语音按钮 |
| `AssistantActionBar` | Copy / Refresh / More(导出 Markdown) |
| `UserActionBar` | Edit 按钮 |
| `EditComposer` | 编辑模式下的输入框（Cancel / Update） |
| `BranchPicker` | 分支切换器（Previous / 序号 / Next） |
| `ThreadScrollToBottom` | 滚动到底部按钮 |
| `MessageError` | 错误信息展示 |

---

### 2.2 thread-list.tsx — 会话列表

**文件**: `packages/web/src/components/assistant-ui/thread-list.tsx`

#### 导出/功能

- **`ThreadList`**: 根组件，包含新建按钮 + 加载骨架/列表切换
- **日期分组**: 按 `lastMessageAt` 排序后分组为 Today / Yesterday / Earlier
- **`ThreadListItem`**: 单项渲染（标题 + 悬停显示更多菜单）
- **`ThreadListItemMore`**: 弹出菜单（Archive / Delete）

#### 状态覆盖

- **加载态**: 5 行 Skeleton 占位
- **空态**: 仅显示 "New Thread" 按钮
- **正常态**: 按时间分组显示的会话列表

---

### 2.3 threadlist-sidebar.tsx — 会话列表侧边栏

**文件**: `packages/web/src/components/assistant-ui/threadlist-sidebar.tsx`

封装 `ThreadList` 到 shadcn/ui 的 `Sidebar` 组件中：
- **Header**: assistant-ui logo + 标题
- **Content**: `ThreadList` 组件
- **Footer**: GitHub 链接

---

### 2.4 assistant-modal.tsx — 弹窗式聊天

**文件**: `packages/web/src/components/assistant-ui/assistant-modal.tsx`

- `AssistantModal`: 右下角固定 Floating 按钮 + 弹出 Popover 内含 `Thread`
- `AssistantModalButton`: 带 BotIcon/ChevronDownIcon 动画切换的触发按钮
- Popover 尺寸: **h-125 w-100**，动画: fade + slide + zoom

### 2.5 assistant-sidebar.tsx — 侧边栏式聊天

**文件**: `packages/web/src/components/assistant-ui/assistant-sidebar.tsx`

- `AssistantSidebar`: `ResizablePanelGroup` 布局，左侧 children，右侧 `Thread`
- 支持拖拽调整面板宽度

---

## 三、消息渲染组件

### 3.1 markdown-text.tsx — Markdown 渲染

**文件**: `packages/web/src/components/assistant-ui/markdown-text.tsx`  
**依赖**: `@assistant-ui/react-markdown` (MarkdownTextPrimitive)

#### 导出

```tsx
export const MarkdownText: FC = memo(MarkdownTextImpl);
```

#### 配置

- **Plugins**: `remarkGfm`（表格、任务列表、删除线等 GFM 扩展）
- **`defaultComponents`**: 通过 `memoizeMarkdownComponents` 缓存的自定义渲染组件
- **代码块**: `CodeHeader`（语言标签 + 复制按钮）+ 自定义 `pre` / `code` 样式
- **支持通过 `componentsByLanguage` 注册语言特定渲染器**（如 mermaid 用 `MermaidDiagram`）

#### 自定义元素列表

h1-h6, p, a, blockquote, ul, ol, hr, table, th, td, tr, li, strong, sup, pre, code, CodeHeader

---

### 3.2 reasoning.tsx — 推理过程展示

**文件**: `packages/web/src/components/assistant-ui/reasoning.tsx`

#### 导出

```tsx
// 复合组件
export const Reasoning: ReasoningMessagePartComponent & {
  Root: typeof ReasoningRoot;      // Collapsible 容器
  Trigger: typeof ReasoningTrigger; // BrainIcon + "Reasoning" 标签
  Content: typeof ReasoningContent; // 可折叠内容区
  Text: typeof ReasoningText;       // 文本滚动容器
  Fade: typeof ReasoningFade;       // 渐变遮罩
};

// 向下兼容
export const ReasoningGroup: ...;
export const reasoningVariants: ...; // outline | ghost | muted
```

#### 核心行为

- **Streaming 模式**: `streaming` prop 为 true 时：
  - 自动展开
  - 底部固定显示实时内容（`isPreview` context）
  - `ResizeObserver` 持续滚动到底部
  - Streaming 结束后自动折叠
- **手动切换**: 用户点击后，`userOpen` 接管，不再自动折叠
- **动画**: 200ms Collapsible 动画，渐变遮罩淡入淡出

---

### 3.3 tool-fallback.tsx — 未知工具 Fallback UI

**文件**: `packages/web/src/components/assistant-ui/tool-fallback.tsx`

#### 导出

```tsx
export const ToolFallback: ToolCallMessagePartComponent & {
  Root: typeof ToolFallbackRoot;       // Collapsible 容器
  Trigger: typeof ToolFallbackTrigger; // "Used tool: <name>" + 状态图标
  Content: typeof ToolFallbackContent; // 折叠内容
  Args: typeof ToolFallbackArgs;       // 参数 JSON 展示
  Result: typeof ToolFallbackResult;   // 结果 JSON 展示
  Error: typeof ToolFallbackError;     // 错误信息
  Approval: typeof ToolFallbackApproval; // 审批按钮组
};
```

#### 状态处理

- **运行中** (`running`): 旋转 LoaderIcon + 闪烁动画，自动展开内容
- **完成** (`complete`): CheckIcon
- **失败** (`incomplete`): XCircleIcon，显示错误信息
- **等待审批** (`requires-action`): AlertCircleIcon，显示 Allow/Deny 按钮组
- **已取消**: 删除线文本，结果不显示

#### 审批流程

1. `requires-action` 时自动展开
2. 显示 Approval 按钮组（支持 AllowOnce/AllowAlways/RejectOnce/RejectAlways 四种选项）
3. 支持 `confirm` 二次确认步骤
4. 调用 `addResult` / `resume` / `respondToApproval` 根据场景自动选择

---

### 3.4 tool-group.tsx — 工具调用分组

**文件**: `packages/web/src/components/assistant-ui/tool-group.tsx`

#### 导出

```tsx
export const ToolGroup: FC<PropsWithChildren<{ startIndex, endIndex }>> & {
  Root: typeof ToolGroupRoot;     // Collapsible 容器
  Trigger: typeof ToolGroupTrigger; // "N tool calls" + 旋转 Loader
  Content: typeof ToolGroupContent; // 折叠内容
};
export const toolGroupVariants: ...; // outline | ghost | muted
```

- 多个连续工具调用合并为一个分组显示
- `active` 时为运行中的工具显示 LoaderIcon
- Variant 控制边框/背景样式

---

### 3.5 directive-text.tsx — 指令文本解析

**文件**: `packages/web/src/components/assistant-ui/directive-text.tsx`

#### 导出

```tsx
export function createDirectiveText(
  formatter: Unstable_DirectiveFormatter,
  options?: CreateDirectiveTextOptions,
): TextMessagePartComponent;

export const DirectiveText: TextMessagePartComponent; // 使用默认 formatter
```

- 解析文本中的 directive 语法（如 `@mention`），渲染为带图标的 Badge Chip
- 支持自定义 `iconMap` 按 directive type 映射图标
- `createDirectiveText` 工厂函数允许自定义 formatter 和图标映射

---

### 3.6 quote.tsx — 引用/选区/输入框引用

**文件**: `packages/web/src/components/assistant-ui/quote.tsx`

#### 导出

```tsx
// 消息中的引用块
export const QuoteBlock: QuoteMessagePartComponent & {
  Root, Icon, Text
};

// 文本选区浮动工具栏
export const SelectionToolbar: FC & {
  Root, Quote
};

// Composer 中的引用预览（引用后显示在输入框上方）
export const ComposerQuotePreview: FC & {
  Root, Icon, Text, Dismiss
};
```

- **QuoteBlock**: 用于 `MessagePrimitive.Quote`，渲染 italic 引用文本
- **SelectionToolbar**: 选中消息文本后弹出，可引用选中内容
- **ComposerQuotePreview**: 输入框中显示当前引用的预览，带关闭按钮

---

### 3.7 sources.tsx — 来源引用

**文件**: `packages/web/src/components/assistant-ui/sources.tsx`

#### 导出

```tsx
export const Sources: SourceMessagePartComponent & {
  Root: typeof Source;   // 带链接的 Badge
  Icon: typeof SourceIcon; // Favicon（DuckDuckGo 图标服务）
  Title: typeof SourceTitle;
};

// 单个 Source 链接 Badge
export const Source: FC<BadgeProps & ComponentProps<"a">>;
```

- URL 来源: 自动提取域名 + 获取 favicon + 显示 title
- Document 来源: FileTextIcon + title
- `Source` 默认 `target="_blank" rel="noopener noreferrer"`

---

### 3.8 file.tsx — 文件展示

**文件**: `packages/web/src/components/assistant-ui/file.tsx`

#### 导出

```tsx
export const File: FileMessagePartComponent & {
  Root,     // 容器
  Icon,     // 按 MIME 类型匹配图标
  Name,     // 文件名
  Size,     // 格式化文件大小
  Download, // data: URL 下载链接
};

// 工具函数
export function getMimeTypeIcon(mimeType: string): FC;
export function getBase64Size(base64: string): number;
export function formatFileSize(bytes: number): string;
```

- 支持的 MIME 类型图标：image/\*, application/pdf, application/json, text/\*, audio/\*, video/\*
- 自动计算 Base64 文件大小
- 三种 Variant: outline / ghost / muted

---

### 3.9 attachment.tsx — 附件

**文件**: `packages/web/src/components/assistant-ui/attachment.tsx`

#### 导出

```tsx
export const UserMessageAttachments: FC;   // 用户消息中的附件（右对齐）
export const ComposerAttachments: FC;      // Composer 中的附件（横向滚动）
export const ComposerAddAttachment: FC;    // 添加附件按钮
```

- `AttachmentUI`: 统一的附件缩略图 + 类型标签 + Tooltip 文件名
- 图片附件支持点击放大预览（Dialog）
- Composer 中的附件带移除按钮
- 使用 `URL.createObjectURL` 生成图片预览

---

## 四、独立配置/选择组件

### 4.1 model-selector.tsx — 模型选择器

**文件**: `packages/web/src/components/assistant-ui/model-selector.tsx`  
**依赖**: `@assistant-ui/react` (useAui), shadcn/ui (Popover, Command)

#### 导出

```tsx
export const ModelSelector: FC<ModelSelectorProps> & {
  Root, Trigger, Value, Content, Search, List,
  Empty, Group, Separator, Item, Effort
};

export const modelSelectorTriggerVariants: ...; // outline | ghost | muted
export const DEFAULT_EFFORT_OPTIONS: ...;       // Low / Medium / High
export function resolveModelEffort(...): string | undefined;

// Hook: 获取当前模型 effort 配置
export function useModelSelectorEfforts(): {
  efforts: ModelSelectorEffortOption[] | undefined;
  effort: string | undefined;
  setEffort: (effort: string) => void;
};
```

#### 核心机制

- **模型选择**: 基于 shadcn/ui Command（cmdk）实现，支持搜索过滤、关键词匹配
- **Effort 选择**: 支持推理强度（Low/Medium/High），仅对支持 reasoning 的模型显示
- **ModelContext 注册**: 通过 `api.modelContext().register()` 自动同步到 assistant-ui 的 ModelContext 系统
- **Controllable State**: 通过 `useControllableState` 支持受控/非受控两种模式
- Effort 跨模型切换保持 sticky

#### ModelOption 类型

```tsx
type ModelOption = {
  id: string;
  name: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
  keywords?: readonly string[];  // 额外搜索关键词
  efforts?: boolean | readonly ModelSelectorEffortOption[];
};
```

---

### 4.2 mcp-config.tsx — MCP 服务器配置

**文件**: `packages/web/src/components/assistant-ui/mcp-config.tsx`  
**依赖**: `@assistant-ui/react-mcp` (McpManagerPrimitive, McpServerPrimitive, McpAddFormPrimitive), shadcn/ui

#### 导出

```tsx
export const McpConfigDialog: FC<{ children?: ReactNode }>;
```

#### 功能

- **连接器区域** (Connectors): 显示预定义的 MCP 连接器（OAuth 授权等）
- **自定义服务器** (Custom Servers): 用户可添加自定义 MCP 服务器
- **ServerCard**: 统一服务器卡片（名称 + 状态 Badge + 操作按钮）
- **AddServerForm**: 添加新服务器表单（名称/URL/认证配置）
- **状态映射**: connected/connecting/authRequired/authPending/error/disconnected → Badge variant + 标签
- **操作按钮**: Connect / Authorize(OAuth) / Disconnect / Remove

---

## 五、上下文/状态展示

### 5.1 context-display.tsx — Token 用量展示

**文件**: `packages/web/src/components/assistant-ui/context-display.tsx`  
**依赖**: `@assistant-ui/react-ai-sdk` (useThreadTokenUsage)

#### 导出

```tsx
export const ContextDisplay: {
  Root,      // 数据提供者 (modelContextWindow + usage)
  Trigger,   // 点击触发元素
  Content,   // Tooltip 内容（详细 breakdown）
  Ring,      // 预设：环形进度图
  Bar,       // 预设：横向进度条 + 数字
  Text,      // 预设：纯文本 "12.5k / 128k"
};
```

#### 三种预设用法

| 预设 | 视觉 | 适用场景 |
|------|------|---------|
| `ContextDisplay.Ring` | SVG 环形进度，24x24 | 紧凑位置 |
| `ContextDisplay.Bar` | 横向进度条 + 百分比 | 侧边栏/列表项 |
| `ContextDisplay.Text` | `格式化的 token / 窗口` | 需要精确数字 |

#### Tooltip 内容

- Usage 百分比
- Input / Cached / Output / Reasoning tokens 分类
- Total: `格式化值 / 窗口大小`

#### 视觉等级

- `percent > 85%` → critical (红色)
- `percent >= 65%` → warning (琥珀色)
- `< 65%` → normal (翡翠色)

---

### 5.2 message-timing.tsx — 消息耗时统计

**文件**: `packages/web/src/components/assistant-ui/message-timing.tsx`  
**依赖**: `@assistant-ui/react` (useMessageTiming)

#### 导出

```tsx
export const MessageTiming: FC<{
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}>;
```

#### 功能

- 流式响应完成后显示总耗时 Badge（如 "2.3s"）
- Hover Tooltip 展示：First token (TTFT)、Total、Speed (tok/s)、Chunks
- 流未完成前返回 null（不渲染）
- 建议放在 `ActionBarPrimitive.Root` 内以继承 autohide 行为

---

## 六、可视化组件

### 6.1 shiki-highlighter.tsx — 代码语法高亮

**文件**: `packages/web/src/components/assistant-ui/shiki-highlighter.tsx`  
**依赖**: `react-shiki` (useShikiHighlighter)

#### 导出

```tsx
export const SyntaxHighlighter: FC<HighlighterProps>;
```

#### 特性

- 基于 Shiki 的语法高亮，支持 light/dark 双主题
- **Streaming 优化**: 流式传输中渲染无高亮的 plain code，完成后切换到高亮版本，避免性能开销
- 通过 `componentsByLanguage` 配置可按语言覆盖渲染器
- 默认主题: `github-dark-default` / `github-light-default`

---

### 6.2 mermaid-diagram.tsx — Mermaid 图表

**文件**: `packages/web/src/components/assistant-ui/mermaid-diagram.tsx`  
**依赖**: `beautiful-mermaid` (renderMermaidSVG)

#### 导出

```tsx
export const MermaidDiagram: FC<MermaidDiagramProps> & {
  Zoom: typeof MermaidZoom;
};
```

#### 特性

- 通过 `componentsByLanguage: { mermaid: { SyntaxHighlighter: MermaidDiagram } }` 注册
- **Streaming 状态**: 渲染 Skeleton 占位图
- **渲染错误**: 显示原始代码 + "diagram could not be rendered"
- **正常状态**: 渲染 SVG + 悬停显示放大按钮
- **Zoom 模式**: 全屏 Portal，支持：
  - 滚轮缩放 (0.5x - 4x)
  - 拖拽平移
  - 工具栏：Zoom In/Out/Reset/Close
  - Focus trap + ESC 关闭

---

### 6.3 diff-viewer.tsx — Diff 查看器

**文件**: `packages/web/src/components/assistant-ui/diff-viewer.tsx`  
**依赖**: `diff` (diffLines), `parse-diff`

#### 导出

```tsx
export const DiffViewer: FC<DiffViewerProps>;

// 子组件
export { DiffViewerFile, DiffViewerHeader, DiffViewerContent,
         DiffViewerLine, DiffViewerSplitLine,
         DiffViewerFileBadge, DiffViewerStats };

// 工具函数
export { parsePatch, computeDiff };
```

#### 功能

- 支持两种输入模式：
  - **Patch 模式**: 传入 `patch` 或 `code`（unified diff 格式字符串），使用 `parse-diff` 解析
  - **双文件模式**: 传入 `oldFile` + `newFile`，使用 `diffLines` 计算差异
- **两种视图**:
  - `unified`: 单列，每行用 +/- 颜色标识
  - `split`: 双列，左右对照
- 文件头显示：文件扩展名 Badge + 文件名（重命名显示 old → new）+ 统计（+N -N）
- Variant: default / ghost / muted

---

### 6.4 dot-matrix.tsx — 状态指示器

**文件**: `packages/web/src/components/assistant-ui/dot-matrix.tsx`

#### 导出

```tsx
export const DotMatrix: FC<{ state?: DotMatrixState; label?: string }>;
export const dotMatrixStates: readonly DotMatrixState[]; // 20 states
```

#### 20种内置状态及动画模式

| 状态 | 动画模式 | 颜色 |
|------|---------|------|
| `idle` | 静态 0.3 透明度 | muted-foreground |
| `loading` | 随机闪烁 | 继承 |
| `thinking` | 行+列延迟扫过 | 继承 |
| `streaming` | 行波动 + 列抖动 | 继承 |
| `searching` | 列扫过 | 继承 |
| `syncing` | 圆周旋转扫过 | 继承 |
| `connecting` | 中心向外方块扩散 | 继承 |
| `waiting` | 省略号动画 | 继承 |
| `uploading` | 从下到上行扫 | 继承 |
| `downloading` | 从上到下行扫 | 继承 |
| `listening` | 列柱状跳动 | 继承 |
| `speaking` | 列柱状快跳 | 继承 |
| `recording` | 录制符号脉冲 | 红色 |
| `success` | 对勾静态 | 翠绿 |
| `error` | 叉号闪烁 | 红色 |
| `warning` | 叹号闪烁 | 琥珀色 |
| `info` | i 符号静态 | 蓝色 |
| `paused` | 暂停符号静态 | muted |
| `stopped` | 停止方块静态 | muted |
| `offline` | 全暗淡 | muted |

- 5x5 网格，使用 CSS `@property` + `@keyframes` 驱动闪烁动画
- 状态切换时各 dot 独立 cross-fade
- 哈希函数确保服务端/客户端渲染一致，DOT 之间无关联

---

### 6.5 number-roll.tsx — 数字滚动动画

**文件**: `packages/web/src/components/assistant-ui/number-roll.tsx`

#### 导出

```tsx
export const NumberRoll: FC<{
  value: number;
  format?: Intl.NumberFormatOptions;
  locales?: Intl.LocalesArgument;
  prefix?: string;
  suffix?: string;
  trend?: "auto" | "up" | "down";
  duration?: number;  // default 500ms
}>;
```

#### 特性

- Odometer-style 数字滚动动画
- 基于 `Intl.NumberFormat` 格式化（支持 compact notation、货币、百分比、多语言）
- 使用 CSS `mod()` + `@property` 实现 GPU 加速的字符滚动
- 不支持 CSS `mod()` 的浏览器降级为静态文本
- SSR 安全：服务端渲染纯文本
- 趋势方向：`auto` 自动检测 / `up` 强制向上 / `down` 强制向下

---

## 七、语音组件

### 7.1 voice.tsx — 语音控制 + 可视化

**文件**: `packages/web/src/components/assistant-ui/voice.tsx`  
**依赖**: `@assistant-ui/react` (useVoiceState, useVoiceControls, useVoiceVolume)

#### 导出

```tsx
// WebGL 语音球体可视化
export const VoiceOrb: FC<{
  state?: VoiceOrbState;    // idle | connecting | listening | speaking | muted
  variant?: VoiceOrbVariant; // default | blue | violet | emerald
  className?: string;
}>;

// VoiceOrb 状态推导
export function deriveVoiceOrbState(voiceState): VoiceOrbState;

// 语音控制条
export const VoiceControl: FC<{ className?: string }>;

// 子组件
export const VoiceStatusDot: FC;     // 状态圆点
export const VoiceConnectButton: FC; // 连接按钮
export const VoiceMuteButton: FC;    // 静音按钮
export const VoiceDisconnectButton: FC; // 断开按钮
```

#### VoiceOrb 实现细节

- **WebGL2** 渲染，Vertex + Fragment Shader
- **Simplex 3D Noise** 驱动流动效果
- 每个状态有独立的动画参数（speed/amplitude/glow/brightness/pulse/saturation）
- 状态切换使用 `lerp` 平滑过渡
- 音量响应的 `volumeRef` 实时影响振幅和速度
- **5 种状态视觉**:
  - idle: 缓慢呼吸
  - connecting: 脉冲闪烁
  - listening: 中等流动 + 音量响应
  - speaking: 快速剧烈流动 + 音量响应
  - muted: 极暗静止

#### 4 种颜色主题

- `default`: 灰度
- `blue`: 蓝色系
- `violet`: 紫色系
- `emerald`: 翠绿色系

---

## 八、Composer 触发组件

### 8.1 composer-trigger-popover.tsx — 触发弹窗

**文件**: `packages/web/src/components/assistant-ui/composer-trigger-popover.tsx`  
**依赖**: `@assistant-ui/react` (ComposerPrimitive.Unstable_TriggerPopover)

#### 导出

```tsx
export const ComposerTriggerPopover: FC<ComposerTriggerPopoverProps>;
```

#### 两种行为模式

1. **Directive 模式** (插入指令 chip):
   ```tsx
   <ComposerTriggerPopover directive={{ formatter, onInserted }} />
   ```
   选中项后，将指令文本写入 Composer

2. **Action 模式** (执行回调):
   ```tsx
   <ComposerTriggerPopover action={{ formatter, onExecute, removeOnExecute }} />
   ```
   选中项后直接执行回调

#### UI 结构

- **类别列表** (Categories): 图标 + 标签 + 箭头
- **子项列表** (Items): 返回按钮 + 图标 + 标签 + 描述
- **空态**: 分 "No items available" / "No matching items"
- 完全可定制：iconMap, fallbackIcon, backLabel, 各类空/加载文本

---

## 九、基础 UI 组件

| 文件 | 导出 | 说明 |
|------|------|------|
| `badge.tsx` | `Badge`, `badgeVariants` | 8 种 variant (outline/secondary/muted/ghost/info/warning/success/destructive), 3 种 size |
| `tooltip-icon-button.tsx` | `TooltipIconButton` | 带 Tooltip 的图标按钮，封装 Button + Tooltip + TooltipTrigger |
| `accordion.tsx` | `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` | 基于 Radix Accordion，3 种 variant (default/outline/ghost) |
| `select.tsx` | `Select`, `SelectRoot`, `SelectTrigger`, `SelectContent`, `SelectItem` 等 | 基于 Radix Select，3 种 trigger variant |
| `tabs.tsx` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | 基于 Radix Tabs，5 种 variant (default/line/ghost/pills/outline)，带动画指示器（hover + active）|

---

## 十、使用模式总结

### 布局方式

本项目使用三种聊天布局：

1. **独立页面** (`Chat.tsx`): 直接 `<Thread />`
2. **弹窗模式** (`AssistantModal`): 右下角 Floating + Popover
3. **侧边栏模式** (`AssistantSidebar`): ResizablePanelGroup

### 自定义组件注入

通过 `Thread` 的 `components` prop 可替换：

```tsx
<Thread components={{
  AssistantMessage: CustomAssistant,
  Welcome: CustomWelcome,
  ToolFallback: CustomToolUI,
  ToolGroup: CustomToolGroup,
  ReasoningGroup: CustomReasoningGroup,
}} />
```

### 注册自定义 Tool UI

Tool UI 通过名称注册，优先级高于 `ToolFallback`：

```tsx
// 在 assistant-ui runtime 配置中注册
// toolUI 在 thread.tsx 的 AssistantMessage 中优先于 ToolFallback 渲染
// 参见: part.toolUI ?? <ToolFallbackComponent {...part} />
```

### Markdown 自定义渲染器

通过 `componentsByLanguage` 可按语言切换渲染器：

```tsx
<MarkdownTextPrimitive
  components={defaultComponents}
  componentsByLanguage={{
    mermaid: { SyntaxHighlighter: MermaidDiagram },
  }}
/>
```

### 上下文用量接入

```tsx
// Ring 预设
<ContextDisplay.Ring modelContextWindow={128000} />

// Bar 预设
<ContextDisplay.Bar modelContextWindow={128000} />

// 自定义布局
<ContextDisplay.Root modelContextWindow={128000} usage={customUsage}>
  <ContextDisplay.Trigger>
    <CustomUI />
  </ContextDisplay.Trigger>
  <ContextDisplay.Content />
</ContextDisplay.Root>
```
