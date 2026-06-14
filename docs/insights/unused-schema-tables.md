# 未使用的 Schema 表梳理

> 生成日期：2026-06-15
> 基于 Mastra Memory 全面升级后的代码分析

## 一、背景

项目已从自定义表存储全面迁移到 Mastra 原生方案（LibSQLStore + LibSQLVector + Memory）。部分旧表虽在 `schema.ts` 中仍有定义，但业务代码已不再使用。

## 二、未使用表清单

### 1. `conversations` — 对话表

| 项目 | 说明 |
|------|------|
| **定义位置** | `schema.ts:85-96` |
| **创建迁移** | `0000_tan_bucky.sql` |
| **当前导出** | schema-index.ts 已不再导出（注释：已移交 Mastra 接管） |
| **替代方案** | Mastra Memory → `mastra_threads` 表 |

**分析**：`conversation-manager.ts` 已全面改用 Mastra Memory API（`memory.listThreads()`、`memory.getThreadById()`）查询对话，读写 `mastra_threads` 表。自定义 `conversations` 表不再被任何业务代码查询或写入。

**代码引用（零业务引用）**：
- `schema.ts` — 仅表定义
- `schema-index.ts` — 已注释掉导出
- 无其他文件 import 或使用该表

---

### 2. `messages` — 消息表

| 项目 | 说明 |
|------|------|
| **定义位置** | `schema.ts:99-107` |
| **创建迁移** | `0000_tan_bucky.sql` |
| **当前导出** | schema-index.ts 已不再导出（注释：已移交 Mastra 接管） |
| **替代方案** | Mastra Memory → `mastra_messages` 表 |

**分析**：消息持久化完全由 Mastra Memory 处理（`memory.recall()`），读写 `mastra_messages` 表。自定义 `messages` 表不再被任何业务代码查询或写入。

**代码引用（零业务引用）**：
- `schema.ts` — 仅表定义
- `schema-index.ts` — 已注释掉导出
- 无其他文件 import 或使用该表

---

### 3. `memory_entries` — 记忆表

| 项目 | 说明 |
|------|------|
| **定义位置** | `schema.ts:110-120` |
| **创建迁移** | `0000_tan_bucky.sql` |
| **当前导出** | schema-index.ts 仍在导出 |
| **替代方案** | Mastra WorkingMemory + SemanticRecall → `mastra_resources` 表 |

**分析**：记忆系统已升级为 Mastra 原生方案（`getMemory()` in `memory-setup.ts`），包含：
- WorkingMemory（模板-based，scope=resource）
- ObservationalMemory（LLM-based 对话观察与反思）
- SemanticRecall（向量跨线程召回，可选）

`memory_entries` 表当前仅被一次性迁移脚本使用：
- `migrate-memory-entries.ts` — 将旧的 type='working' 条目迁移到 Mastra WorkingMemory
- `index.ts` — 启动时调用迁移（非关键路径，失败仅 warn）

**迁移完成后该表即可移除。**

**代码引用**：
| 文件 | 用途 |
|------|------|
| `schema.ts` | 表定义 |
| `schema-index.ts` | 导出 |
| `migrate-memory-entries.ts` | 一次性数据迁移（读取旧数据写入 Mastra） |
| `index.ts:26` | 启动时调用迁移 |

---

## 三、已移除表（历史记录）

以下表在 schema.ts 中已注释掉定义，仅保留在旧迁移文件中：

| 表名 | 移除原因 | 替代方案 |
|------|---------|---------|
| `chunks` | 向量存储 | `LibSQLVector`（Mastra） |
| `tool_call_logs` | 工具调用审计 | Output Processor 审计日志 |
| `token_usage_logs` | Token 追踪 | Output Processor Token 跟踪 |

---

## 四、清理建议

### 短期（无风险，纯清理）

1. 从 `schema.ts` 移除 `conversations` 和 `messages` 表定义
2. 从 `schema-index.ts` 移除 `memory_entries` 导出

### 中期（迁移完成后）

1. 确认所有租户的 `memory_entries` 已迁移至 WorkingMemory
2. 从 `schema.ts` 移除 `memory_entries` 表定义
3. 删除 `migrate-memory-entries.ts`
4. 从 `index.ts` 移除迁移调用
5. 创建新的 drizzle 迁移以删除这 3 张表

---

## 五、当前活跃表（对照）

以下表仍在业务中使用，无需变动：

| 表名 | 主要使用方 |
|------|-----------|
| `model_configs` | model-manager.ts, model-bridge.ts |
| `agents` | agent-manager.ts, team-network.ts, seed.ts |
| `installed_skills` | skill/manager.ts, skills API |
| `agent_skills` | agent-manager.ts, skill/manager.ts |
| `knowledge_bases` | knowledge-manager.ts, rag.ts |
| `agent_knowledge_bases` | agent-manager.ts, knowledge-manager.ts |
| `agentTeams` | team-manager.ts, team-network.ts |
| `agentTeamMembers` | team-manager.ts, team-network.ts |
| `exec_approvals` | approval-service.ts, exec-approvals API |
| `eval_datasets` | evals/datasets.ts, evals API |
| `eval_test_cases` | evals/datasets.ts, evals API |
| `eval_runs` | evals/runner.ts, evals API |
| `eval_case_results` | evals/runner.ts, evals API |
