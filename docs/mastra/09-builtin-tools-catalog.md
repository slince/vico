# Mastra 内置工具完整清单

> 涵盖 Mastra 项目中所有内置工具的梳理，共 **58 个工具**，按类别分组。

## 1. 总览

| 类别 | 数量 | 说明 |
|------|------|------|
| Core Built-in | 6 | Agent 无关的通用基础工具 |
| Code Mode | 1 | TypeScript 沙箱执行 |
| Workspace — 文件系统 | 9 | 文件读写/编辑/列表/搜索 |
| Workspace — 沙箱 | 3 | Shell 命令执行/进程管理 |
| Workspace — 搜索 | 2 | BM25 + 向量语义搜索 |
| Workspace — LSP | 1 | Language Server Protocol 代码检查 |
| Memory | 2 | 对话记忆召回 + 工作记忆更新 |
| Skill | 3 | Skill 加载/搜索/读取 |
| Browser | 16 | 基于 Playwright 的浏览器自动化 |
| Agent Builder | 15 | Agent 构建器专用编码工具 |
| **合计** | **58** | |

---

## 2. Core Built-in 工具（6 个）

文件：`packages/core/src/tools/builtin/`

这些工具任何 Agent 都可使用，**默认无需审批**。其中 `ask_user` 和 `submit_plan` 使用 Agent 暂停/恢复（suspend/resume）机制实现人机交互。

### `ask_user`
| 属性 | 内容 |
|------|------|
| **作用** | 暂停 Agent 执行，向用户提问并等待回复 |
| **支持模式** | 自由文本、单选 (`single_select`)、多选 (`multi_select`) |
| **参数** | `question` (string), `options` ([{label, description}]), `selectionMode` |
| **审批** | 无需，使用 suspend/resume |
| **来源** | `builtin/ask-user.ts:81` |

### `submit_plan`
| 属性 | 内容 |
|------|------|
| **作用** | 提交执行计划供用户审批，支持 approve/reject/request_changes |
| **参数** | `title` (string), `plan` (string, markdown) |
| **审批** | 无需，使用 suspend/resume |
| **来源** | `builtin/submit-plan.ts:52` |

### `task_write`
| 属性 | 内容 |
|------|------|
| **作用** | 创建/全量替换结构化任务列表，管理编码会话进度 |
| **状态** | `pending`, `in_progress`, `completed` |
| **参数** | `tasks` (array of {id?, content, status, activeForm}) |
| **审批** | 否 |
| **来源** | `builtin/task-tools.ts:422` |

### `task_update`
| 属性 | 内容 |
|------|------|
| **作用** | 按 ID 更新单个任务（内容/状态/activeForm） |
| **参数** | `id` (string), `content?`, `status?`, `activeForm?` |
| **审批** | 否 |
| **来源** | `builtin/task-tools.ts:476` |

### `task_complete`
| 属性 | 内容 |
|------|------|
| **作用** | 按 ID 标记单个任务已完成 |
| **参数** | `id` (string) |
| **审批** | 否 |
| **来源** | `builtin/task-tools.ts:545` |

### `task_check`
| 属性 | 内容 |
|------|------|
| **作用** | 查看当前任务完成状态，返回 total/completed/inProgress/pending 统计 |
| **参数** | 无 |
| **审批** | 否 |
| **来源** | `builtin/task-tools.ts:600` |

---

## 3. Code Mode 工具（1 个）

文件：`packages/core/src/tools/code-mode/code-mode.ts`

### `execute_typescript`
| 属性 | 内容 |
|------|------|
| **作用** | 在沙箱中执行 TypeScript 程序，通过 RPC 桥接调用所有可用工具 |
| **适用场景** | 多步骤任务、批处理、数据聚合——比逐个调用工具更高效 |
| **参数** | `code` (string——完整的 TypeScript 程序，通过 `external_<toolId>` 调用其他工具) |
| **审批** | 可配置 |
| **来源** | `code-mode/code-mode.ts:73` |

---

## 4. Workspace — 文件系统工具（9 个）

文件：`packages/core/src/workspace/tools/`，工具名均以 `mastra_workspace_` 为前缀。审批可按工具配置，默认均不需要。

### 4.1 文件操作

| 工具名 | 作用 | 关键参数 |
|--------|------|----------|
| `mastra_workspace_read_file` | 读取文件内容，支持文本(png/jpeg/webp/pdf 原生解析)和行范围 | `path`, `offset`, `limit`, `showLineNumbers`, `encoding` |
| `mastra_workspace_write_file` | 写入文件内容（自动创建父目录） | `path`, `content`, `overwrite` |
| `mastra_workspace_edit_file` | 精确文本搜索替换（`old_string` 必须唯一） | `path`, `old_string`, `new_string`, `replace_all` |
| `mastra_workspace_list_files` | 列出目录树（紧凑缩进格式，节省 token） | `path`, `maxDepth`, `showHidden`, `exclude`, `pattern`, `respectGitignore` |
| `mastra_workspace_delete` | 删除文件或目录 | `path`, `recursive` |
| `mastra_workspace_file_stat` | 获取文件元信息（存在性、类型、大小、mtime） | `path` |
| `mastra_workspace_mkdir` | 创建目录 | `path`, `recursive` |

### 4.2 搜索/分析

| 工具名 | 作用 | 关键参数 |
|--------|------|----------|
| `mastra_workspace_grep` | ripgrep 驱动的正则/模式搜索，返回匹配行+文件+行号 | `pattern`, `path`, `contextLines`, `maxCount`, `caseSensitive` |
| `mastra_workspace_ast_edit` | AST-grep 驱动的语法感知代码转换（添加/移除import、重命名、模式替换） | `path`, `pattern`, `replacement`, `transform`, `targetName`, `newName` |

---

## 5. Workspace — 沙箱工具（3 个）

### `mastra_workspace_execute_command`
| 属性 | 内容 |
|------|------|
| **作用** | 在沙箱中执行 Shell 命令，支持管道/重定向/后台运行 |
| **参数** | `command`, `timeout`, `cwd`, `tail`, `background` |
| **来源** | `workspace/tools/execute-command.ts:289` |

### `mastra_workspace_get_process_output`
| 属性 | 内容 |
|------|------|
| **作用** | 按 PID 获取后台进程的 stdout/stderr 和运行状态 |
| **参数** | `pid`, `tail`, `wait` |
| **来源** | `workspace/tools/get-process-output.ts:9` |

### `mastra_workspace_kill_process`
| 属性 | 内容 |
|------|------|
| **作用** | 按 PID 终止后台进程，返回最后 50 行输出 |
| **参数** | `pid` |
| **来源** | `workspace/tools/kill-process.ts:11` |

---

## 6. Workspace — 搜索工具（2 个）

### `mastra_workspace_search`
| 属性 | 内容 |
|------|------|
| **作用** | 搜索工作区已索引内容，支持 BM25/向量/混合模式 |
| **参数** | `query`, `topK`, `mode` (bm25/vector/hybrid), `minScore` |
| **来源** | `workspace/tools/search.ts:17` |

### `mastra_workspace_index`
| 属性 | 内容 |
|------|------|
| **作用** | 为内容建立搜索索引（路径作为文档 ID） |
| **参数** | `path`, `content`, `metadata` |
| **来源** | `workspace/tools/index-content.ts:7` |

---

## 7. Workspace — LSP 工具（1 个）

### `mastra_workspace_lsp_inspect`
| 属性 | 内容 |
|------|------|
| **作用** | 使用 Language Server Protocol 检查代码位置，返回 hover 信息、诊断、定义和实现位置 |
| **参数** | `path` (绝对路径), `line` (1-indexed), `match` (含 `<<<` 光标标记的行) |
| **来源** | `workspace/tools/lsp-inspect.ts:80` |

---

## 8. Memory 工具（2 个）

文件：`packages/memory/src/tools/`

### `recall`
| 属性 | 内容 |
|------|------|
| **作用** | 浏览/搜索对话历史和线程 |
| **三种模式** | `messages`：分页浏览历史（低/高详情）；`threads`：列出线程（日期过滤）；`search`：语义搜索观察组 |
| **参数** | `mode`, `query`, `cursor`, `threadId`, `limit`, `detail` (low/high), `partType`, `toolName`, `before`, `after` |
| **审批** | 否 |
| **来源** | `memory/src/tools/om-tools.ts:1158` |

### `updateWorkingMemory` / `setWorkingMemory`
| 属性 | 内容 |
|------|------|
| **作用** | 更新工作记忆（用户信息、偏好等） |
| **两种模式** | Schema 模式：深度合并 (deepMerge)；模板模式：全量替换 Markdown |
| **参数** | `memory` (string 或 object), `newMemory?`, `searchString?`, `updateReason?` |
| **审批** | 否 |
| **来源** | `memory/src/tools/working-memory.ts:95` |

---

## 9. Skill 工具（3 个）

文件：`packages/core/src/workspace/skills/tools.ts`，审批均为否。

### `skill`
| 属性 | 内容 |
|------|------|
| **作用** | 按名称或路径加载 Skill 的完整指令及 references/scripts/assets 列表 |
| **参数** | `name` (skill 名称或路径) |
| **来源** | `workspace/skills/tools.ts:82` |

### `skill_search`
| 属性 | 内容 |
|------|------|
| **作用** | 在所有 Skill 内容中搜索相关信息（BM25/向量/混合） |
| **参数** | `query`, `skillNames?`, `topK?` |
| **来源** | `workspace/skills/tools.ts:122` |

### `skill_read`
| 属性 | 内容 |
|------|------|
| **作用** | 从 Skill 目录（references/scripts/assets）读取文件，支持行范围 |
| **参数** | `skillName`, `path`, `startLine?`, `endLine?` |
| **来源** | `workspace/skills/tools.ts:166` |

---

## 10. Browser 工具（16 个）

文件：`browser/agent-browser/src/tools/`，工具名均以 `browser_` 为前缀，审批均为否。浏览器的核心交互模型是**可访问性树引用**：先 `snapshot` 获取带有元素引用 (`[ref=e1]`) 的文本表示，再用引用进行后续操作。

| 工具名 | 作用 | 关键参数 |
|--------|------|----------|
| `browser_goto` | 导航到 URL | `url`, `waitUntil` |
| `browser_snapshot` | 获取可访问性树快照（元素引用） | `target`（可选元素） |
| `browser_click` | 点击元素（支持双击） | `element`, `clickCount`, `waitUntil` |
| `browser_type` | 输入文本到元素 | `element`, `text`, `clear`, `submit`, `slowly` |
| `browser_press` | 按键（Enter/Tab/Escape/组合键） | `key`, `waitUntil` |
| `browser_select` | 下拉选择（按值/标签/索引） | `element`, `values`, `waitUntil` |
| `browser_scroll` | 滚动页面或元素 | `target`, `direction` |
| `browser_hover` | 悬停元素（触发 tooltip/dropdown） | `element` |
| `browser_drag` | 拖拽元素到另一个元素 | `startElement`, `endElement` |
| `browser_back` | 返回上一页 | 无参数 |
| `browser_close` | 关闭浏览器 | 无参数 |
| `browser_wait` | 等待文本出现/消失或指定时间 | `time`, `text`, `textGone` |
| `browser_tabs` | 标签管理（list/new/close/select） | `action`, `index`, `url` |
| `browser_dialog` | 处理浏览器对话框（alert/confirm/prompt） | `element`, `accept`, `promptText` |
| `browser_screenshot` | 截取可见区域或全页面截图（PNG/JPEG） | `element?`, `fullPage`, `type` |
| `browser_evaluate` | 在浏览器中执行 JavaScript（高级逃逸口） | `function` |

---

## 11. Agent Builder 工具（15 个）

文件：`packages/agent-builder/src/defaults.ts`

这些是 **Agent Builder Agent**（用于脚手架搭建/构建 Mastra 应用的 Agent）的专用工具集。在 `template` 模式下只有前 10 个可用。

| 工具名 | 作用 | 关键参数 |
|--------|------|----------|
| `read-file` | 读取文件内容，支持行范围 | `filePath`, `startLine`, `endLine`, `encoding` |
| `write-file` | 写入文件（自动创建目录） | `filePath`, `content`, `createDirs`, `encoding` |
| `list-directory` | 列出目录，支持过滤/递归 | `path`, `recursive`, `pattern`, `maxDepth` |
| `execute-command` | 执行 Shell 命令 | `command`, `workingDirectory`, `timeout`, `shell`, `env` |
| `task-manager` | 结构化任务管理（create/update/list/complete/remove） | `action`, `tasks`, `taskId` |
| `multi-edit` | **原子**多文件搜索替换（带备份） | `operations` (array of file edits), `createBackup` |
| `replace-lines` | 按行号范围替换（1-indexed） | `filePath`, `startLine`, `endLine`, `newContent` |
| `show-file-lines` | 显示指定行（调试编辑用） | `filePath`, `startLine`, `endLine`, `context` |
| `smart-search` | 智能搜索（text/regex/fuzzy/semantic） | `query`, `type`, `scope`, `context` |
| `validate-code` | 代码验证（语法→TypeScript语义→ESLint） | `projectPath`, `validationType`, `files` |
| `web-search` | 网页搜索（DuckDuckGo） | `query`, `maxResults`, `dateRange` |
| `attempt-completion` | 完成信号（变更摘要+验证状态+置信度） | `summary`, `changes`, `validation`, `nextSteps` |
| `manage-project` | 项目管理（创建/安装/升级包） | `action`, `features`, `packages` |
| `manage-server` | Mastra 服务器管理（start/stop/restart/status） | `action`, `port` |
| `http-request` | HTTP 请求（用于测试 Agent/API） | `method`, `url`, `headers`, `body`, `timeout` |

---

## 12. 审批策略

| 工具类别 | 审批策略 |
|----------|----------|
| Core Built-in | `ask_user`/`submit_plan` 使用 suspend/resume，其他不需要 |
| Code Mode | 可配置 |
| Workspace 工具 | **可按工具独立配置**，默认无需审批 |
| Memory | 无需审批 |
| Skill | 无需审批 |
| Browser | 无需审批 |
| Agent Builder | 无需审批 |

Workspace 工具的高危操作（`write_file`, `delete`, `mkdir`, `execute_command`）建议设为需要审批：
```typescript
workspace: {
  tools: {
    [FILESYSTEM.WRITE_FILE]: { requireApproval: true },
    [FILESYSTEM.DELETE]: { requireApproval: true },
    [SANDBOX.EXECUTE_COMMAND]: { requireApproval: true },
  }
}
```

---

## 13. 工具注册到 Agent 的流程

```
Agent 初始化
  │
  ├── listAssignedTools()         → 直接分配的工具
  ├── listMemoryTools()           → recall + updateWorkingMemory
  ├── listToolsets()              → 外部 toolset
  ├── listClientTools()           → 客户端工具
  ├── listAgentTools()            → 子 Agent 作为工具
  ├── listWorkflowTools()         → Workflow 作为工具
  ├── listWorkspaceTools()        → 15 个 mastra_workspace_* 工具
  ├── listSkillTools()            → skill + skill_search + skill_read
  ├── listChannelTools()          → 通道工具
  ├── listBrowserTools()          → 16 个 browser_* 工具
  └── listInputProcessorLoadedTools() → 处理器注入的工具
       │
       ▼
  allTools → wrapToolsWithHooks() → AI SDK CoreTools
```

---

## 14. 关键文件索引

| 类别 | 文件 |
|------|------|
| Core Built-in | `packages/core/src/tools/builtin/ask-user.ts` |
| Core Built-in | `packages/core/src/tools/builtin/submit-plan.ts` |
| Core Built-in | `packages/core/src/tools/builtin/task-tools.ts` |
| Code Mode | `packages/core/src/tools/code-mode/code-mode.ts` |
| Workspace — 文件系统 | `packages/core/src/workspace/tools/read-file.ts` 等 |
| Workspace — 沙箱 | `packages/core/src/workspace/tools/execute-command.ts` |
| Workspace — 搜索 | `packages/core/src/workspace/tools/search.ts` |
| Workspace — LSP | `packages/core/src/workspace/tools/lsp-inspect.ts` |
| Memory | `packages/memory/src/tools/working-memory.ts` |
| Memory | `packages/memory/src/tools/om-tools.ts` |
| Skill | `packages/core/src/workspace/skills/tools.ts` |
| Browser | `browser/agent-browser/src/tools/*.ts` |
| Agent Builder | `packages/agent-builder/src/defaults.ts` |
