# @vico/tool

工具框架与内置工具。

提供 Tool 定义、ToolExecutor 执行器、审批策略（StormBreaker、approval resolver）与一组内置工具（文件系统、编码、浏览器、web fetch、todo、ask_user）。

## 主要导出

- `createTool` / `ToolOptions` — 工具定义
- `ToolExecutor` / `AgentHost` / `ToolExecutionContext` — 工具执行器
- `StormBreaker` — 风暴熔断（并发/预算控制）
- 审批策略 — `isPathInWorkspace` / `composeResolvers` / `defaultApprovalResolvers` / `toolPolicyResolver` / `approvalModeResolver` / `ApprovalPriority`
- 内置工具 — `readTool` / `bashTool` / `editTool` / `writeTool` / `grepTool` / `findTool` / `lsTool` / `lspTool` / `webFetchTool` / `todoTool` / `askUserTool` / `browserNavigateTool` / `browserSnapshotTool` / `browserClickTool`，以及分组 `basicTools` / `filesystemTools` / `codingTools` / `baseBuiltinTools` / `fileBuiltinTools` / `coreBuiltinTools` / `resolveWorkspacePath`
- 类型 — `Tool` / `ToolCall` / `ToolResult` / `ToolPolicy` / `ToolKind` / `ToolTag` / `ToolCallContext` / `Approval*` / `PolicyContext` / `ApprovalResolver` / `ApprovalDecider` / `ApprovalMode` / `ApprovalStatus`

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/types` | 基础数据契约 |
| `@vico/stream`（value） | toolResultPart 等 stream parts |
| `@vico/thread`（type） | TurnSession 等 |
| `ai` / `zod` | AI SDK 工具类型 / schema 校验 |

## 备注

`createDelegateTool`（创建子 agent 的工具）不在此包，已移入 `@vico/agent` 以打破运行时环（见 [拆分方案](../core/SPLIT-PLAN.md)）。

## 相关文档

- [ask_user 工具协议](../../docs/insights/tool-ask-user-protocol.md)
- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)
