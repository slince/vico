# Coding Agent 能力补齐计划

## 背景

当前 Vico 已有基本 Agent 引擎和 13 个内置工具，但要支持 coding agent 场景还有以下缺口需要补齐（已排除 #3 命令级审批粒度）。

## Phase 1: 基础修复（必须先做）

### 1.1 修复路径 containment 绕过

**现状**: 6 个文件工具各自复制了一份 `resolvePath()`，绝对路径（以 `/` 开头）直接放行，可访问系统任意文件。

**方案**:
- 新增 `packages/agent/src/tool/builtin/workspace.ts`，导出统一的 `resolveWorkspacePath(workspace, targetPath)` 函数
- 修改逻辑：绝对路径也必须 resolve 后检查是否在 workspace 内，不在则抛错
- 保留一个允许列表的扩展点（如允许读取 `/usr/bin` 下的系统工具信息）
- 将所有 6 个文件工具的 resolvePath 替换为统一调用

### 1.2 打通服务端 workspace 和 builtin_tools 配置

**现状**: 
- `chat.ts` 创建 agent 时从不设置 `workspace`，导致文件工具永不可用
- `builtin_tools` DB 字段已存储但从未被读取/消费

**方案**:
- `getAgentRuntimeConfig()` 返回 `workspace`（来自 `server.config.yaml` 的 `workspace.base_path`）和 `builtin_tools`
- `chat.ts` 中将 workspace 和工具过滤传入 AgentConfig
- 实现 `filterBuiltinTools(config, builtinToolsConfig)` 函数，根据 DB 配置决定启用/禁用哪些内置工具

---

## Phase 2: 核心 Coding 工具

### 2.1 Git 工具套件

**新增文件**: `packages/agent/src/tool/builtin/git/`

| 工具 | kind | policy | 功能 |
|------|------|--------|------|
| git_status | readonly | auto | `git status --porcelain`，解析为结构化 JSON |
| git_diff | readonly | auto | `git diff`（支持 staged/unstaged/文件），输出 diff 文本 |
| git_log | readonly | auto | `git log --oneline -N`，返回 commit 列表 |
| git_commit | mutation | on-request | 创建 commit，需 message 参数 |
| git_branch | readonly | auto | 列出 / 创建 / 切换分支 |
| git_checkout | file_change | on-request | 切换分支或恢复文件 |

**实现方式**: 每个工具在 workspace 目录执行对应 git 命令，使用 `execSync`，解析输出为结构化结果。

### 2.2 HTTP 请求工具

**新增文件**: `packages/agent/src/tool/builtin/web-fetch-tool.ts`

| 工具 | kind | policy | 功能 |
|------|------|--------|------|
| web_fetch | readonly | on-request | 发起 HTTP 请求，返回响应体（文本/JSON） |

- 支持 method、headers、body、timeout 参数
- 自动截断大响应（默认 100KB）
- 仅允许 HTTP/HTTPS URL

### 2.3 增强 edit 工具（线号编辑 + 多文件）

**修改文件**: `packages/agent/src/tool/builtin/edit-tool.ts`

- 在现有字符串替换模式基础上，新增 **行号编辑模式**：
  - `startLine` / `endLine` 参数指定行范围（1-based）
  - `newContent` 替换指定行内容（空字符串 = 删除行）
  - `insertAt` 参数支持在指定行后插入新行
- 输出中包含行号标注的 diff

---

## Phase 3: 高级工具

### 3.1 bash 工具改进

**修改文件**: `packages/agent/src/tool/builtin/bash-tool.ts`

- 将 `exec()` 改为 `spawn()`，支持流式输出（通过 session poll 获取增量输出）
- 输出中明确包含 exit code
- 添加 `dryRun` 参数：仅显示将执行的命令，不实际运行
- 添加 session 超时自动清理（默认 10 分钟）
- 修复同 session_id 重复 run 导致旧进程泄漏的问题

### 3.2 包管理工具

**新增文件**: `packages/agent/src/tool/builtin/package-tools.ts`

| 工具 | kind | policy | 功能 |
|------|------|--------|------|
| package_install | command | on-request | 检测包管理器(npm/yarn/pnpm/pip)，安装依赖 |
| package_run | command | on-request | 执行 package.json scripts 或 pip 命令 |

### 3.3 任务规划工具

**新增文件**: `packages/agent/src/tool/builtin/todo-tool.ts`

| 工具 | kind | policy | 功能 |
|------|------|--------|------|
| todo_write | mutation | auto | 创建/更新结构化任务列表，用于多步任务跟踪 |

- 输入：tasks 数组 `[{id, content, status}]`
- 输出：当前完整任务列表
- 纯内存存储，per-turn 生命周期

---

## Phase 4: 高级能力

### 4.1 实现 LSP 集成

**修改文件**: `packages/agent/src/tool/builtin/lsp-tool.ts`

- 新增 `lsp_start` 子命令：启动语言服务器进程（通过 `spawn`），管理与 LSP 进程的 JSON-RPC 通信
- 实现 `diagnostics` action：发送 `textDocument/didOpen` + `textDocument/diagnostic` 请求
- 实现 `go_to_definition` action：发送 `textDocument/definition` 请求
- 实现 `completions` action：发送 `textDocument/completion` 请求
- LSP 进程按文件语言自动选择（从 workspace 的 `lsp` 配置读取映射表）
- 用作 `execSync`/`spawn` 的子进程管理

### 4.2 Skill 脚本执行

**新增文件**: `packages/agent/src/skill/tool/skill-execute.ts`

| 工具 | kind | policy | 功能 |
|------|------|--------|------|
| skill_execute | command | on-request | 执行 skill scripts 目录下的脚本 |

- 输入：skillName + scriptName + args
- 在 workspace 中执行，使用 bash 执行
- 限制只能执行 Skill.scripts 中列出的文件

### 4.3 子 Agent / 委托机制

**修改文件**: `packages/agent/src/tool/tool-broker.ts` + 新增 delegate 工具

- 创建 `DelegateTool`（kind: `delegate`）：可创建子 agent 执行独立子任务
- 子 agent 继承父 agent 的部分配置（model、workspace），但可使用更受限的工具集
- ToolBroker 中 delegate 类型工具按顺序执行（与 mutation 同级）
- 子 agent 的 conversation 回传给父 agent

### 4.4 浏览器工具

**新增文件**: `packages/agent/src/tool/builtin/browser-tool.ts`

| 工具 | kind | policy | 功能 |
|------|------|--------|------|
| browser_navigate | command | on-request | 导航到 URL |
| browser_snapshot | readonly | auto | 获取页面 accessibility snapshot |
| browser_click | command | on-request | 点击页面元素 |

- 基于 Playwright，需按需安装 `playwright` 依赖
- 浏览器实例按 session 管理

---

## 实施顺序

```
Phase 1 (基础修复) → Phase 2 (核心工具) → Phase 3 (高级工具) → Phase 4 (高级能力)
```

每个 Phase 内部的工具可并行开发。
