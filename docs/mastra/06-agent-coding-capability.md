# Mastra Agent Coding 能力实现

> 基于 `mastra` 项目源码深度分析，涵盖代码执行沙箱、Agent Builder、工作区工具、浏览器自动化等编码能力。

## 1. 概述

Mastra 的 Agent Coding 能力通过**分层组合架构**实现，没有单一的 "CodeAgent" 类。任何 Agent 通过组合 Workspace、Sandbox、CodeMode、Browser 等组件即可获得编码能力。核心架构：

```
Agent
  ├── Workspace（文件系统 + 沙箱）
  │   ├── 文件操作工具（读/写/编辑/删除/列表）
  │   ├── 搜索工具（ripgrep/BM25/向量）
  │   ├── AST 编辑工具（ast-grep）
  │   ├── LSP 检查工具
  │   └── execute_command（Shell 执行）
  ├── CodeMode（编写并执行 TypeScript 程序）
  ├── Browser（Playwright 自动化）
  ├── MCP（外部工具/文档集成）
  └── Agent Builder（用自然语言构建 Agent）
```

---

## 2. CodeMode：Agent 编写和执行代码

### 2.1 核心概念

CodeMode 是 Mastra 最核心的编码执行机制。Agent 可以**编写 TypeScript 程序，然后在沙箱中执行**，程序通过 RPC 桥接调用宿主工具。

**核心文件**：`packages/core/src/tools/code-mode/`

### 2.2 架构流程

```
Agent
  │
  ├─ 调用 execute_typescript 工具
  │   参数: { code: "import { external_read } from 'tools'; ..." }
  │
  ▼
  CodeMode Transport (transport.ts)
  │
  ├─ 1. 生成 TypeScript 工具桩 (stub-generator.ts)
  │     每个可用工具映射为 external_<toolId>()
  │     形成完整的 TypeScript 类型定义
  │
  ├─ 2. 注入 Runner 脚本 (runner.ts)
  │     包含 RPC 协议 (FRAME_PREFIX)
  │     支持并发调用 (Promise.all 批处理)
  │     捕获 console 输出
  │
  ├─ 3. 写入临时目录
  │     通过 TypeScript 剥离类型 (-experimental-strip-types 或 tsx)
  │
  ├─ 4. 在 WorkspaceSandbox 中执行
  │     node --experimental-strip-types tmp/program.ts
  │
  └─ 5. RPC Bridge 通信
        每个 external_<toolId>() 调用 → JSON-RPC 帧
        → Stdio → 宿主分发到真实工具管道
        → 保留验证、追踪、请求上下文
```

### 2.3 RPC 协议

```typescript
// runner.ts
const FRAME_PREFIX = '___MASTRA_RPC___';

// 每个工具调用发送 JSON-RPC 帧
function createRpcFrame(id: string, toolId: string, params: any) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: toolId,
    params,
  });
}

// 支持并行调用
const results = await Promise.all([
  external_read({ path: 'file1.ts' }),
  external_read({ path: 'file2.ts' }),
  external_grep({ pattern: 'TODO' }),
]);
```

### 2.4 核心接口

```typescript
// code-mode.ts
interface CodeModeConfig {
  sandbox: WorkspaceSandbox;        // 必需！否则抛错
  tools: Record<string, Tool>;      // 暴露给程序的工具
  workspace?: Workspace;            // 工作区
  timeout?: number;                  // 执行超时
  maxOutputLength?: number;          // 输出截断长度
}

function createCodeMode(config: CodeModeConfig): {
  tool: Tool;                        // execute_typescript 工具
  instructions: string;              // Agent 系统指令
}

// types.ts
interface CodeModeResult {
  stdout: string;                    // 标准输出
  stderr: string;                    // 标准错误
  exitCode: number;                  // 退出码
  toolCalls: ToolCallResult[];       // RPC 工具调用结果
}
```

### 2.5 工具桩生成 (stub-generator.ts)

为每个暴露的工具生成 TypeScript 类型桩：

```typescript
// 生成的桩示例
declare module 'tools' {
  export function external_workspace_read_file(
    path: string,
    options?: { startLine?: number; endLine?: number }
  ): Promise<string>;
  
  export function external_workspace_grep(
    pattern: string,
    options?: { path?: string; glob?: string }
  ): Promise<GrepResult[]>;
  
  export function external_workspace_execute_command(
    command: string,
    options?: { cwd?: string; timeout?: number }
  ): Promise<CommandResult>;
}
```

### 2.6 安全设计

1. **沙箱隔离**：代码在沙箱中运行，不能直接访问宿主资源
2. **工具调用门控**：所有 `external_*` 调用经过宿主工具管道（验证、追踪、审批）
3. **不支持直接文件系统访问**：必须通过 `external_workspace_*` 工具
4. **显示支持 LocalSandbox**：仅用于可信/本地场景

---

## 3. Workspace 沙箱系统

### 3.1 文件：`packages/core/src/workspace/sandbox/`

#### WorkspaceSandbox 接口

```typescript
// sandbox.ts
interface WorkspaceSandbox {
  // 执行命令（核心方法）
  executeCommand(params: {
    command: string;
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    stdin?: string;
  }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
  
  // 后台进程管理（可选）
  processes?: {
    spawn(params: SpawnParams): Promise<Process>;
    kill(pid: string): Promise<void>;
    getOutput(pid: string): Promise<ProcessOutput>;
    list(): Promise<Process[]>;
  };
  
  // 文件系统挂载（可选）
  mount?(params: MountParams): Promise<void>;
  unmount?(path: string): Promise<void>;
}
```

#### 沙箱实现类型

| 实现 | 文件 | 说明 |
|------|------|------|
| `LocalSandbox` | `local-sandbox.ts` | 本地机器执行，支持 `none`/`seatbelt`/`bwrap` 隔离级别 |
| `MastraSandbox` | `mastra-sandbox.ts` | 高阶包装器，增加生命周期、追踪、挂载管理 |
| `ExecaSandbox` | `execa.ts` | 基于 `execa` 的跨平台命令执行 |

#### 原生沙箱后端

| 后端 | 文件 | 说明 |
|------|------|------|
| Seatbelt | `native-sandbox/seatbelt.ts` | macOS `sandbox-exec` |
| Bubblewrap | `native-sandbox/bubblewrap.ts` | Linux `bwrap` |

#### 进程管理器

```typescript
// process-manager/
interface ProcessManager {
  spawn(params: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  }): Promise<Process>;
  
  kill(pid: string): Promise<void>;
  getOutput(pid: string): Promise<{
    stdout: string;
    stderr: string;
    isRunning: boolean;
  }>;
  list(): Promise<Process[]>;
}
```

Agent 可以启动开发服务器、运行测试、等待结果——完整的开发工作流。

---

## 4. Workspace 工具集（Agent 编码工具）

### 4.1 文件：`packages/core/src/workspace/tools/`

所有工具在 Agent 连接 Workspace 后自动可用：

#### 文件操作工具

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `workspace_read_file` | `read-file.ts` | 读取文件，支持行范围、编码 |
| `workspace_write_file` | `write-file.ts` | 写入文件，自动创建目录 |
| `workspace_edit_file` | `edit-file.ts` | 行级编辑，基于行号替换 |
| `workspace_delete_file` | `delete-file.ts` | 删除文件 |
| `workspace_list_files` | `list-files.ts` | 目录列表，支持过滤、递归、`.gitignore` 感知 |
| `workspace_file_stat` | `file-stat.ts` | 文件元信息 |
| `workspace_mkdir` | `mkdir.ts` | 创建目录 |

#### 命令执行工具

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `workspace_execute_command` | `execute-command.ts` | 执行 Shell 命令 |
| `workspace_get_process_output` | `get-process-output.ts` | 获取后台进程输出 |
| `workspace_kill_process` | `kill-process.ts` | 终止后台进程 |

#### 搜索工具

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `workspace_grep` | `grep.ts` | ripgrep 驱动的正则/模式搜索 |
| `workspace_search` | `search.ts` | BM25 + 可选向量搜索 |
| `workspace_index_content` | `index-content.ts` | 文件索引 |

#### 代码分析工具

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `workspace_ast_edit` | `ast-edit.ts` | AST-grep 驱动的语法感知代码转换 |
| `workspace_lsp_inspect` | `lsp-inspect.ts` | LSP 协议代码检查（hover、定义、引用、诊断） |

### 4.2 execute_command 工具详解

```typescript
// execute-command.ts
{
  name: 'workspace_execute_command',
  parameters: {
    command: string;       // Shell 命令
    cwd?: string;          // 工作目录
    timeout?: number;      // 超时（秒）
    background?: boolean;  // 后台模式 → 返回 PID
  },
  // 支持管道、重定向、链接 (&& || ;)
  // 实时 stdout/stderr 流式输出
  // 浏览器 CLI 检测（playwright/chrome → 自动注入 CDP URL）
}
```

### 4.3 AST 编辑工具

```typescript
// ast-edit.ts（使用 @ast-grep/napi）
{
  name: 'workspace_ast_edit',
  parameters: {
    pattern: string;          // AST-grep 模式
    replacement?: string;     // 替换文本
    paths?: string[];         // 目标文件
    language?: string;        // 语言类型
  },
  // 模式匹配查找替换
  // 导入管理
  // 多文件转换
  // 工作区级只读安全检查
}
```

### 4.4 LSP 检查工具

```typescript
// lsp-inspect.ts
{
  name: 'workspace_lsp_inspect',
  parameters: {
    filePath: string;
    line: number;
    column: number;
    // 用 <<< 标记光标位置
  },
  // 返回：hover 信息、定义位置、引用列表、诊断信息
}
```

---

## 5. Agent Builder：用自然语言构建 Agent

### 5.1 `AgentBuilder` 类

文件：`packages/agent-builder/src/agent/index.ts`

```typescript
class AgentBuilder extends Agent {
  constructor(config: {
    mode: 'template' | 'code-editor';  // 模板模式 / 全代码编辑器模式
    // template 模式：有限工具集，用于模板合并
    // code-editor 模式：全工具集，用于代码生成
  }) {
    super({
      temperature: 0.3,       // 锁定 0.3 以保证代码一致性
      maxSteps: 100,          // 更长的代码生成会话
      memory: {
        processors: [new ToolSummaryProcessor()]  // 过滤上下文
      },
      instructions: AgentBuilderDefaults.DEFAULT_INSTRUCTIONS,
    });
  }
}
```

### 5.2 AgentBuilder 工具集

文件：`packages/agent-builder/src/defaults.ts`（约 3000 行）

| 工具 | 功能 | 关键特性 |
|------|------|----------|
| `readFile` | 读取文件 | 行范围、编码、元数据 |
| `writeFile` | 写入文件 | 自动创建目录 |
| `multiEdit` | 多文件编辑 | 原子搜索替换、备份创建 |
| `replaceLines` | 行替换 | 1-based 行号替换 |
| `showFileLines` | 显示行号 | 调试编辑 |
| `listDirectory` | 目录列表 | 过滤、递归、.gitignore 感知 |
| `executeCommand` | 执行命令 | 超时、工作目录、环境变量 |
| `taskManager` | 任务管理 | pending/in_progress/completed/blocked |
| `smartSearch` | 智能搜索 | 文本/正则/模糊/语义模式 |
| `validateCode` | 代码验证 | 语法→TypeScript 语义→ESLint |
| `webSearch` | 网页搜索 | DuckDuckGo API |
| `attemptCompletion` | 完成信号 | 变更摘要、验证状态、置信度 |
| `manageProject` | 项目管理 | 创建项目、安装/升级包 |
| `manageServer` | 服务器管理 | 启动/停止/重启 Mastra 开发服务器 |
| `httpRequest` | HTTP 请求 | 向服务器或外部 API 发送请求 |

### 5.3 MASTRA 方法（系统指令模式）

Agent Builder 遵循内建的 **UNDERSTAND → PLAN → BUILD → VALIDATE** 流程：

```
1. UNDERSTAND —— 理解项目、查阅文档
2. PLAN      —— 规划变更、任务分解
3. BUILD     —— 编写代码、逐个任务完成
4. VALIDATE  —— 验证代码、类型检查、lint
```

### 5.4 代码验证（validateCode）

混合验证策略：

```
1. 语法检查 (TypeScript 解析器, ~1ms)  → 捕获 80% 问题
2. 语义验证 (完整 TypeScript 程序, ~100ms) → 类型检查
3. ESLint (~50ms) → 风格/最佳实践
4. 无指定文件时回退到 npx tsc --noEmit (~2000ms)
```

TypeScript 程序懒加载并缓存以提升性能。

文件目标快速路径 ~150ms，CLI 回退 ~2000ms。

### 5.5 Agent Builder Agent（构建 Agent 的 Agent）

文件：`packages/editor/src/ee/agent-builder-agent.ts`

```typescript
function createBuilderAgent(config: BuilderAgentConfig): Agent {
  return new Agent({
    workspace: new Workspace({
      filesystem: new LocalFilesystem({ basePath: skillsDir }),
    }),
    errorProcessors: [
      new StreamErrorRetryProcessor(),     // 重试 OpenAI 瞬时错误
      new PrefillErrorHandler(),           // 恢复 Anthropic prefill 错误
      new ProviderHistoryCompat(),          // 修复提供商历史格式不兼容
    ],
    // ...其他配置
  });
}
```

---

## 6. Coding Agent Skill

### 6.1 概述

文件：`packages/editor/src/ee/workspace/skills/coding-agent/SKILL.md`

这是一个**创作剧本（Authoring Playbook）**，指导 Agent Builder Agent 如何构建编码 Agent。它不是可执行代码，而是规范指令。

### 6.2 两种模式

| 模式 | 适用场景 | 工具配置 |
|------|----------|----------|
| **Workspace-connected** | 需要文件访问、仓库编辑 | 全文件系统工具 + 搜索 + 终端 |
| **No-workspace code generator** | 自包含代码片段生成 | 有限工具集 |

### 6.3 关键行为规则

- **MUST 条款**：
  - "如果本地找不到项目，必须使用你拥有的凭据克隆它"
  - 工具优先级：文件写入 → 代码搜索（grep/ripgrep）→ 测试运行/shell 执行 → 版本控制
  - 使用当前版本的 API 参考，不要假设或发明 API
  - 提供完成的最终摘要（变更内容 + 为什么）

- **禁止行为**：
  - 非导师模式（不教用户、不列举替代方案、不生成示例代码用于教学）
  - 不发明 API
  - 不生成应该由其他 Agent 处理的内容

- **完成标准**：
  - 验证已完成：类型/Lint 检查、必要时的测试运行
  - 所有指定任务已处理
  - 如果没有需要完成的任务或不完整且有障碍，向用户报告

### 6.4 其他可用 Skill

| Skill | 用途 |
|-------|------|
| `customer-support-agent` | 客服 Agent |
| `generic-assistant` | 通用助手 |
| `agent-prompt-quality-bar` | 提示词质量基准 |
| `spreadsheet-agent` | 电子表格 Agent |
| `content-writer-agent` | 内容写作 Agent |
| `ops-automation-agent` | 运维自动化 Agent |
| `research-agent` | 研究 Agent |

---

## 7. Browser 自动化

### 7.1 `@mastra/agent-browser`

文件：`browser/agent-browser/`

基于可访问性树引用的确定性浏览器自动化。Agent 可以控制浏览器执行 Web 任务。

**15 个浏览器工具**：

| 工具 | 功能 |
|------|------|
| `browser_goto` | 导航到 URL |
| `browser_snapshot` | 获取可访问性树（元素引用 `@e1`, `@e2`） |
| `browser_click` | 点击元素 |
| `browser_type` | 输入文本 |
| `browser_press` | 按键 |
| `browser_select` | 选择下拉选项 |
| `browser_scroll` | 滚动页面 |
| `browser_hover` | 悬停元素 |
| `browser_drag` | 拖拽 |
| `browser_wait` | 等待文本/时间 |
| `browser_back` | 后退 |
| `browser_tabs` | 标签管理 |
| `browser_dialog` | 对话框处理 |
| `browser_close` | 关闭浏览器 |
| `browser_evaluate` | **在浏览器中执行 JavaScript** |

### 7.2 browser_evaluate 工具

```typescript
// evaluate.ts
{
  name: 'browser_evaluate',
  parameters: {
    function: string,  // JavaScript 表达式或函数
    element?: string,  // 可选：在元素上下文中执行
  },
  execute: async ({ function: fn, element }) => {
    // 在浏览器上下文中执行 JavaScript
    return await page.evaluate(fn);
  }
}
```

Agent 可以在浏览器上下文中执行任意 JavaScript，用于数据提取、页面操作等。

### 7.3 其他浏览器包

| 包 | 说明 |
|------|------|
| `@mastra/stagehand` | 使用 Stagehand 的视觉+可访问性方法进行更高级自动化 |
| `@mastra/firecrawl` | 基于 Firecrawl CDP 的浏览器自动化 |
| `browser-viewer` | 实时观察 Agent 浏览器活动（投屏） |

---

## 8. Editor（Agent 管理平台）

### 8.1 `MastraEditor` 类

文件：`packages/editor/src/index.ts`

中央 Agent 管理和配置平台，桥接存储的 Agent 定义与运行时 `Mastra` 实例。

**可插拔 Provider 架构**：

```typescript
class MastraEditor {
  __filesystems: Map<string, FilesystemProvider>;    // local, S3, GCS
  __sandboxes: Map<string, SandboxProvider>;          // local, E2B, Docker, Modal
  __blobStores: Map<string, BlobStoreProvider>;       // 技能存储
  __browsers: Map<string, BrowserProvider>;           // stagehand, agent-browser
  __toolProviders: Map<string, ToolProvider>;         // Composio, Arcade
  __processorProviders: Map<string, ProcessorProvider>; // moderation, token limiter
}
```

### 8.2 Code-as-Source 模式

```
source: 'code' → Agent 覆盖保存在磁盘上
               默认: ./mastra/editor/
               可选: GitHub PR 工作流（SourceControlProvider）
```

### 8.3 命名空间

| 命名空间 | 功能 |
|----------|------|
| `EditorAgentNamespace` | Agent CRUD + 版本管理 + 克隆 |
| `EditorWorkspaceNamespace` | 工作区管理 + 快照序列化 |
| `EditorPromptNamespace` | 可复用提示词块管理 |
| `EditorScorerNamespace` | 评估指标管理 |
| `EditorMCPNamespace` | MCP 配置 |
| `EditorSkillNamespace` | Skill 管理 |

---

## 9. MCP 生态系统（编码工具集成）

### 9.1 `@mastra/mcp-docs-server`

文件：`packages/mcp-docs-server/`

将 Mastra 文档作为 MCP 工具暴露，Agent 可自助查询文档：

| 工具 | 功能 |
|------|------|
| `docs` | 读取 Mastra 文档 |
| `embeddedDocs` | 嵌入式文档 |
| `course` | 学习课程 |
| `migration` | API 迁移信息 |

### 9.2 CLI 集成

MCP 文档服务器可安装到 Claude Code、Cursor、Windsurf 等 IDE：

```bash
mastra init --mcp-docs-server  # 自动配置到编辑器
```

---

## 10. 编码能力的组装模式

在 Mastra 中，编码 Agent 按以下方式组合：

```typescript
// 创建一个编码 Agent
const codingAgent = new Agent({
  name: 'code-agent',
  instructions: 'You are an expert programmer...',
  model: 'claude-sonnet-4-6',
  
  // 1. 连接工作区（获得文件系统工具）
  workspace: new Workspace({
    filesystem: new LocalFilesystem({ basePath: '/project' }),
    sandbox: new LocalSandbox({ isolation: 'seatbelt' }),
  }),
  
  // 2. 连接浏览器（获得 Web 自动化）
  browser: new AgentBrowser(),
  
  // 3. 可选：连接 MCP 服务器
  mcpServers: [new MCPDocsServer()],
  
  // 4. 可选：启用 CodeMode
  tools: {
    execute_typescript: createCodeMode({
      sandbox: workspace.sandbox,
      tools: workspace.tools,
    }),
  },
  
  // 5. 配置 Skills（知识注入）
  skills: ['./skills/coding-agent'],
});
```

### 组件依赖关系

```
                    ┌──────────────┐
                    │    Agent     │
                    └──────┬───────┘
          ┌────────────────┼────────────────┐
          ▼                ▼                 ▼
   ┌──────────┐    ┌──────────────┐    ┌─────────┐
   │Workspace │    │  CodeMode    │    │ Browser │
   │  ├ Filesystem│  │ ├ stub-gen  │    │ ├ goto  │
   │  ├ Sandbox│   │ │ ├ runner   │    │ ├ click │
   │  ├ Tools  │    │ │ ├ transport│   │ ├ type  │
   │  └ Search │    │ │ └ RPC      │    │ └ eval  │
   └──────────┘    └──────────────┘    └─────────┘
          │                │                 │
          ▼                ▼                 ▼
   ┌──────────────────────────────────────────────┐
   │              Sandbox 层 (安全隔离)             │
   │  LocalSandbox | Seatbelt | Bubblewrap | E2B  │
   └──────────────────────────────────────────────┘
```

---

## 11. 关键文件索引

### CodeMode
- `packages/core/src/tools/code-mode/code-mode.ts` — 工具工厂
- `packages/core/src/tools/code-mode/runner.ts` — 沙箱内 Runner 脚本
- `packages/core/src/tools/code-mode/transport.ts` — Stdio RPC 传输层
- `packages/core/src/tools/code-mode/stub-generator.ts` — TypeScript 桩生成
- `packages/core/src/tools/code-mode/types.ts` — 类型定义
- `packages/core/src/tools/code-mode/code-mode.e2e.test.ts` — E2E 测试

### Workspace 工具
- `packages/core/src/workspace/tools/execute-command.ts`
- `packages/core/src/workspace/tools/read-file.ts`
- `packages/core/src/workspace/tools/write-file.ts`
- `packages/core/src/workspace/tools/edit-file.ts`
- `packages/core/src/workspace/tools/ast-edit.ts`
- `packages/core/src/workspace/tools/lsp-inspect.ts`
- `packages/core/src/workspace/tools/grep.ts`

### 沙箱
- `packages/core/src/workspace/sandbox/sandbox.ts`
- `packages/core/src/workspace/sandbox/local-sandbox.ts`
- `packages/core/src/workspace/sandbox/native-sandbox/seatbelt.ts`
- `packages/core/src/workspace/sandbox/native-sandbox/bubblewrap.ts`

### Agent Builder
- `packages/agent-builder/src/agent/index.ts`
- `packages/agent-builder/src/defaults.ts`
- `packages/editor/src/ee/agent-builder-agent.ts`
- `packages/editor/src/ee/agent-builder.ts`
- `packages/editor/src/ee/workspace/skills/coding-agent/SKILL.md`

### 浏览器
- `browser/agent-browser/src/tools/evaluate.ts`
- `browser/agent-browser/src/agent-browser.ts`

### CLI
- `packages/cli/src/commands/init/init.ts`

### MCP
- `packages/mcp-docs-server/src/tools/docs.ts`
- `packages/mcp/src/client/client.ts`
