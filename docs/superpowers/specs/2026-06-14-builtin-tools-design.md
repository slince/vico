# Builtin Tools 设计文档

## 概述

为 Vico Agent 引擎新增 7 个内置基础工具（read/write/edit/exec/grep/find/ls），支持按 Agent 配置的细粒度工具选择，exec 命令限制在全局 workspace 目录下执行并支持 Web 端审批流程。

## 工具清单

| 工具 | 功能 | 核心参数 |
|------|------|---------|
| read | 读取文件，支持文本和图片 | path, offset?, limit? |
| write | 写入文件，自动建目录 | path, content |
| edit | 精确文本替换 | path, old_string, new_string |
| exec | 执行脚本 | command, timeout? |
| grep | 内容搜索 | pattern, path?, include? |
| find | 文件名搜索 | pattern, path? |
| ls | 目录列表 | path? |

## 目录结构

```
packages/server/src/agent/tools/builtin/
├── index.ts              # Barrel export + BuiltinToolManager 单例
├── read.ts               # 读文件
├── write.ts              # 写文件
├── edit.ts               # 精确文本替换
├── exec.ts               # 执行脚本 + 审批流
├── grep.ts               # 内容搜索
├── find.ts               # 文件名搜索
├── ls.ts                 # 目录列表
└── common/
    ├── path-utils.ts     # 路径解析 + 安全校验（防路径穿越）
    └── truncate.ts       # 输出截断（行数/字节限制）
```

## 架构

### 工具模式

每个工具使用 Mastra `createTool()` 创建，Zod schema 定义输入，与现有 `weather-tool.ts` 风格一致。公共逻辑抽取到 `common/` 共享模块。

### BuiltinToolManager 单例

```
class BuiltinToolManager:
  - workspace: string (from YAML config)
  - getToolsForAgent(agentId, tenantId) → Record<string, Tool>
    1. 从 agentManager 获取 Agent 的 builtin_tools JSON
    2. 按需实例化对应 Tool（复用已创建的实例）
    3. exec 工具额外注入 needApproval 标志
```

### 注册集成

工具注入两个层面：

1. **agent-tool.factory.ts** — `createAgentTool()` 中，在已有的 skillTools + ragTool 基础上追加 builtin tools，使子 Agent 也拥有配置的内置工具
2. **main.agent.ts** — mainAgent 自身也注入 builtin tools，让调度器可以直接使用

## 数据库变更

### agents 表新增字段

```sql
ALTER TABLE agents ADD COLUMN builtin_tools TEXT NOT NULL DEFAULT '{}';
```

`builtin_tools` 存储 JSON 对象，key 为工具名，value 为 boolean + 可选配置：

```json
{
  "read": true,
  "write": true,
  "edit": false,
  "exec": { "enabled": true, "need_approval": true },
  "grep": true,
  "find": true,
  "ls": true
}
```

### exec_approvals 新表

```sql
CREATE TABLE exec_approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  command TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
```

## 配置变更

`packages/server/server.config.yaml` 新增：

```yaml
tools:
  timeout_ms: 30000  # 已有
  builtin:
    workspace: "/var/vico/workspace"  # exec 命令限制在此目录下
```

`packages/server/src/config.ts` 类型定义同步新增 `tools.builtin.workspace`。

## 工具设计细节

### read
- 读取文本/图片文件
- MIME 检测：图片返回 base64 data URL
- 截断策略：默认 2000 行或 100KB，先到先截
- 超出截断提示 `use offset=N to continue`
- 路径安全校验（防 `../../etc/passwd` 穿越）

### write
- 写入内容到文件
- 自动递归创建父目录
- 返回写入字节数和路径
- 路径安全校验

### edit
- 精确文本替换（old_string → new_string）
- old_string 在文件中必须唯一且只出现一次
- 匹配失败返回错误（含 failure context）
- 返回替换后 diff 预览

### exec
- 使用 `child_process.spawn` 执行命令
- 命令在配置的 workspace 目录下执行
- 默认超时 60s
- 输出截断：同 read 策略
- 审批流程（见下文）

### grep
- 内容正则搜索
- 支持 glob 文件过滤（include 参数）
- 默认搜索路径为 workspace
- 返回行号 + 匹配行内容

### find
- 文件名 glob 搜索
- 返回匹配文件路径列表

### ls
- 目录列表
- 返回文件和子目录名数组

## exec 审批流程

### 配置方式

exec 工具在 `builtin_tools` 中支持 `need_approval` 子配置：

```json
{
  "exec": { "enabled": true, "need_approval": true }
}
```

### 流程

```
Agent 调用 exec tool
       ↓
  need_approval == true?
      /          \
    true         false
     ↓              ↓
  写入 exec_approvals   直接 spawn 执行
  (status=pending)        ↓
     ↓              返回结果给 Agent
  SSE 推送
  approval_required 事件
  到 Web 端
     ↓
  Web 端展示命令
  用户点击批准/拒绝
     ↓
  POST /api/exec-approvals/:id/resolve
      /          \
   批准         拒绝
     ↓              ↓
  spawn 执行    status=rejected
     ↓              ↓
  返回结果     "命令已被拒绝"
```

### 新增 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/exec-approvals/pending` | 获取当前租户待审批列表 |
| POST | `/api/exec-approvals/:id/resolve` | 批准/拒绝 {action: "approve"\|"reject"} |

### SSE 事件

新增事件类型 `approval_required`：

```
event: approval_required
data: {"approvalId": "xxx", "command": "npm test", "agentId": "agent_xxx"}
```

### Web 端

- 聊天页面监听 `approval_required` SSE 事件
- 弹出审批卡片展示命令内容
- 提供批准/拒绝按钮
- 审批结果通过 API 回调

## 路径安全

所有文件操作工具共享 `common/path-utils.ts` 的安全校验：

1. 解析路径为绝对路径
2. 校验绝对路径是否在 workspace 目录下（startsWith）
3. 拒绝符号链接穿越
4. 非法路径返回明确错误信息

## 类型变更

### AgentRow / AgentDetail

```typescript
// types.ts 新增
export interface BuiltinToolConfig {
  enabled: boolean;
  need_approval?: boolean; // exec only
}

export type BuiltinToolsConfig = Record<string, boolean | BuiltinToolConfig>;
```

### createAgentSchema / updateAgentSchema

```typescript
// 新增字段
builtin_tools: z.record(z.string(), z.union([z.boolean(), z.object({
  enabled: z.boolean(),
  need_approval: z.boolean().optional(),
})])).optional().default({}),
```

## 实现顺序

1. `common/path-utils.ts` + `common/truncate.ts` — 公共模块
2. 各工具文件：read → write → edit → grep → find → ls → exec
3. `builtin/index.ts` — BuiltinToolManager
4. `src/config.ts` — 新增 workspace 配置
5. DB migration — agents 表加字段 + exec_approvals 新表
6. 集成点 — agent-tool.factory.ts + main.agent.ts
7. API 路由 — exec-approvals 端点
8. Web 端 — 审批 UI
