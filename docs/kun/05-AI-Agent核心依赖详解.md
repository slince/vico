# Kun AI Agent 核心依赖详解

## 一、依赖哲学

Kun 的依赖选择遵循**极简自研**路线：

- **不使用**任何 AI Agent 框架（LangChain、CrewAI、AutoGPT、Mastra 等）
- **不使用**任何厂商 AI SDK（openai、@anthropic-ai/sdk、@google/generative-ai）
- **不使用**任何 HTTP 框架（Express、Fastify、Koa、Hono）
- **不使用**任何外部数据库（PostgreSQL、MySQL、Redis）
- **不使用**任何向量数据库（Chroma、Pinecone、Weaviate、Qdrant等）
- **不使用**任何外部的可观测性/日志平台

核心能力全部**手写实现**，仅依赖底层基础库。

---

## 二、LLM 客户端：手写 CompatModelClient

### 2.1 设计

文件：`kun/src/adapters/model/compat-model-client.ts`（约 2600 行）

**零 SDK 依赖**。使用 Node.js 原生 `fetch` API 发送 HTTP POST 请求。

### 2.2 支持的协议

```
┌─────────────────────────────────────┐
│         CompatModelClient            │
│                                      │
│  ┌─────────────────────────────────┐│
│  │ OpenAI Chat Completions          ││
│  │ POST /v1/chat/completions       ││
│  │ (默认格式)                       ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ OpenAI Responses API            ││
│  │ POST /v1/responses              ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ Anthropic Messages API          ││
│  │ POST /v1/messages               ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ Custom 端点（用户自定义）        ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

### 2.3 流式处理

- **SSE (Server-Sent Events)** 解析：手写流解析器
- 解析 `data:` 行，提取 JSON 块
- 支持 `text_delta`、`reasoning_delta`、`tool_call_delta`
- 非流式模式回退：直接解析完整 JSON 响应

### 2.4 容错机制

```
请求失败
  ├── 502/503/504 → 重试（最多 2 次，指数退避）
  ├── 流空闲超时（默认 45 秒）→ 取消
  ├── 网络错误 → 立即失败
  └── AbortSignal → 取消

代理支持：proxy-agent 自动检测 http_proxy/https_proxy 环境变量
```

### 2.5 推理协议转换

不同厂商的"思考/推理"API 差异巨大。CompatModelClient 内部做了协议翻译：

| 厂商 | 推理参数 | 实现方式 |
|------|---------|---------|
| DeepSeek | `reasoning_effort` | chat.completions 参数 |
| GLM | `reasoning_effort` | chat.completions 参数 |
| MiMo | 独立 reasoning 字段 | 消息级别 reasoning_content |
| Anthropic | `thinking` type + `budget_tokens` | Messages API thinking 块 |
| OpenAI Responses | `reasoning` config | 响应级别的 reasoning |

### 2.6 计费

内建计费估算（硬编码价格表）：

文件：`kun/src/adapters/model/deepseek-pricing.ts`、`minimax-pricing.ts`

- DeepSeek V4：每 1M Token 的 USD/CNY 价格
- MiniMax：各模型的价格
- 每 Turn 累计计算，通过 `/v1/usage` API 暴露

---

## 三、MCP（Model Context Protocol）集成

### 3.1 依赖

```json
{
  "@modelcontextprotocol/sdk": "^1.29.0"
}
```

这是 Kun 唯一的外部 AI 协议 SDK 依赖。

### 3.2 传输层支持

文件：`kun/src/adapters/tool/mcp-tool-provider.ts`

| 传输方式 | 说明 |
|---------|------|
| `stdio` | 启动子进程，通过 stdin/stdout 通信 |
| `sse` | HTTP SSE 连接 |
| `streamable-http` | Streamable HTTP（MCP 规范新增） |

### 3.3 工具发现模式

```typescript
type McpToolDiscovery = 'direct' | 'search' | 'auto'

// direct: 直接列出所有 MCP 工具（适合少量工具）
// search: 将大量工具折叠为搜索入口（BM25 检索）
// auto: 自动选择
```

### 3.4 信任域

```typescript
type McpTrustScope = 'user' | 'workspace'
// user: 用户级信任（全局可用）
// workspace: 工作区级信任（仅当前项目）
```

### 3.5 后台重连

慢启动的 MCP 服务器会自动重连，不阻塞 Agent 启动。

---

## 四、存储系统：JSONL + SQLite 混合

### 4.1 SQLite

依赖：
```json
{
  "better-sqlite3": "^12.10.0"
}
```

配置：
- **WAL 模式**（Write-Ahead Logging）
- **5 秒忙等待超时**
- **可重建索引**（非权威数据源）
- 自动列迁移（`addColumnIfMissing`）
- 预编译语句缓存

### 4.2 JSONL（JSON Lines）

权威数据存储格式，每行一个 JSON 对象，追加写入。

```
<dataDir>/threads/{threadId}/
  ├── metadata.jsonl    # Thread 元数据快照（>1MB 自动压缩）
  ├── messages.jsonl    # Turn 项记录
  ├── events.jsonl      # 运行时事件
  └── session.json      # Session 快照
```

### 4.3 Backfill 机制

启动时自动将 events.jsonl 中的 usage 数据同步到 SQLite `usage_events` 表，按 200 行一批提交，避免阻塞事件循环。

---

## 五、Zod — 类型安全的基石

### 5.1 依赖

```json
{
  "zod": "^4.4.3"
}
```

Zod 4 被用于 Kun 的几乎所有层面：

- **配置校验**：KunConfig Schema 全量 Zod 校验
- **IPC 契约**：src/main/ipc/app-ipc-schemas.ts
- **共享类型**：src/shared/* 中的大量 Schema
- **运行时合约**：kun/src/contracts/* 中所有接口
- **模型能力**：ModelCapabilityMetadata Schema
- **工具输入**：所有工具的 inputSchema 使用 Zod + JSON Schema

---

## 六、计算机控制

### 6.1 依赖

```json
{
  "@computer-use/nut-js": "^4.2.0"
}
```

### 6.2 功能

- 鼠标移动/点击
- 键盘输入
- 屏幕截图
- 沙箱策略控制
- 权限管理（通过 `services/computer-use-permissions.ts`）

---

## 七、桌面端核心依赖

### 7.1 Electron 生态

| 依赖 | 版本 | 用途 |
|------|------|------|
| `electron` | ^34 | 桌面壳 |
| `electron-vite` | ^3.1.0 | 构建工具（代替 Webpack） |
| `electron-builder` | ^26 | 打包/签名/公证 |
| `electron-updater` | ^6.8.3 | 自动更新（R2/S3 存储） |
| `electron-store` | ^10.1.0 | 持久化键值设置 |

### 7.2 前端核心

| 依赖 | 版本 | 用途 |
|------|------|------|
| `react` | ^19 | UI 框架 |
| `zustand` | ^5.0.3 | 状态管理（全局 Store） |
| `tailwindcss` | ^3 | 原子化 CSS，暗色模式 |
| `@tiptap/*` | ^3.26 | 富文本编辑器（Write 模式） |
| `@codemirror/*` | ^6 | 代码编辑器 |
| `@xterm/xterm` | ^6 | 终端模拟器 |
| `shiki` | ^3.23 | 语法高亮 |
| `react-markdown` | - | Markdown 渲染 |
| `streamdown` | ^2.5 | 流式 Markdown 渲染 |
| `react-i18next` / `i18next` | ^25 | 国际化（en/zh） |

### 7.3 图像与文档处理

| 依赖 | 用途 |
|------|------|
| `jimp` | 图像处理/压缩 |
| `pdfjs-dist` | PDF 渲染 |
| `html-to-docx` | HTML → Word 导出 |

---

## 八、外部平台集成

### 8.1 微信

```json
{
  "@tencent-weixin/openclaw-weixin": "^2.4.3"
}
```

文件：`src/main/weixin-bridge-runtime.ts`

通过 `vendor/openclaw-shim` 兼容层处理与微信插件的交互。

### 8.2 飞书/Lark

```json
{
  "@larksuiteoapi/node-sdk": "^1.64.0"
}
```

文件：`src/main/feishu-streamer.ts`

支持飞书消息流的 Agent 交互。

---

## 九、对比分析：Kun vs Vico 依赖策略

### 9.1 架构依赖对比

| 层面 | Kun | Vico |
|------|-----|------|
| **后端框架** | 手写 HTTP Server + Router | Hono 4 |
| **Agent 引擎** | 自研 AgentLoop (~2400 行) | Vercel AI SDK (`ai` 包) |
| **LLM 客户端** | 手写 CompatModelClient (~2600 行) | 通过 AI SDK 统一抽象 |
| **数据库 ORM** | 无（直接调 better-sqlite3） | Drizzle ORM |
| **认证** | 手写 Bearer Token | better-auth |
| **校验** | Zod 4 | Zod |
| **工作流** | 自研 | AI SDK `streamText` |
| **Embedding** | 无 | Transformers.js / OpenAI |
| **子 Agent** | 自研 Delegation 系统 | 无 |

### 9.2 自研 vs 复用决策

Kun 选择自研的核心模块：
1. **HTTP 服务器和 Router** — 避免框架依赖，追求极致可控
2. **Agent 循环** — 需要精确控制每步行为，现成框架抽象不满足需求
3. **LLM 客户端** — 需要多协议兼容和精细的流控
4. **工具系统** — 需要审批、策略、Hook、沙箱等定制功能
5. **上下文压缩** — 需要混合策略（启发式 + LLM 总结）

Kun 选择复用的模块：
1. **SQLite** — better-sqlite3 是成熟方案
2. **MCP SDK** — 外部协议，无需自研
3. **Electron 生态** — 标准桌面壳方案
4. **Zustand/React 等前端库** — 标准前端技术栈

### 9.3 对 Vico 的参考价值

Kun 对 Vico 最有参考价值的模块：

1. **AgentLoop 设计**：多步循环、工具并行执行、Goal 恢复、审批门控 — Vico 可考虑在 AI SDK 基础上增加类似控制层
2. **工具策略系统**：`auto/on-request/suggest/never/untrusted` 的策略分级值得借鉴
3. **上下文压缩**：混合启发式 + LLM 总结，Token 经济管理
4. **子 Agent 委托**：`readOnly` / `inherit` 策略，并行槽信号量控制
5. **Hook 系统**：Agent 生命周期的可编程干预点
6. **Cache-First 策略**：不可变系统前缀的 Prompt 缓存利用

Kun 的不足（Vico 优于 Kun 的方面）：
1. **向量检索**：Vico 有完整 Embedding + 余弦相似度 + 混合搜索（70/30）
2. **多租户**：Vico 有 tenant_id 数据隔离
3. **认证体系**：Vico 的 better-auth 更成熟
4. **Skill 代码执行**：Vico 的 Skill 可以包含可执行工具代码
5. **ORM**：Vico 的 Drizzle 提供更好的类型安全和迁移管理
