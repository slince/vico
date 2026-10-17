# 模型配置高级选项（上下文窗口 / 最大输出 tokens）

## 背景

「模型管理」设置页此前只能配置厂商、模型名、API Key、Base URL、是否默认，缺少生成模型的上下文窗口与输出上限配置。本次参照 WeKnora 的模型配置页，在新增/编辑模型弹窗中增加「高级选项」折叠区，含两个字段：

- **上下文窗口**（`context_window`）：该模型支持的上下文上限（token）。
- **最大输出 tokens**（`max_output_tokens`）：单次回复的输出上限。

## 预填充规则

选中厂商并输入/选择模型名时，从 `/api/v1/llm-providers`（`server/src/llm/providers/*.json`）的对应模型条目预填充：

- 目录条目带 `context_window` / `max_output_tokens` → 自动填入；
- 目录无该模型条目（如「自定义 OpenAI 兼容」）或条目未携带字段 → 留空，交用户手填。

匹配逻辑见 `web/src/pages/settings/providers.ts` 的 `getModelCapabilities`：按类型筛选相关条目（chat/vllm 取无 `model_type` 的条目，embedding/rerank/asr 取 `model_type` 匹配条目），先按模型 `id` 精确匹配，再回退 `kind === 'pattern'` 的 glob 匹配。

「高级选项」仅对 `chat` / `vllm`（对话/视觉）模型类型展示——这两个字段是生成参数，embedding/rerank/asr 不适用。

## 关键文件

| 文件 | 职责 |
|------|------|
| `server/src/db/schema.ts` | `model_configs` 增加 `context_window` / `max_output_tokens`（integer，可空） |
| `server/drizzle/0013_add_model_context_window.sql` / `0014_add_model_max_output_tokens.sql` + `meta/_journal.json` | 迁移（每条一个 `ALTER`，勿合并在一个文件） |
| `server/src/services/model/types.ts` | `ModelConfigRow` 补两个字段 |
| `server/src/services/model/model-manager.ts` | `create()` 写入两列；`update()` 通用复制，null 原样写入 |
| `web/src/pages/settings/providers.ts` | `CatalogModel` 补字段 + `getModelCapabilities` 纯函数 |
| `web/src/pages/settings/ModelManagement.tsx` | 表单状态、预填充、提交、列表卡片展示 |
| `web/src/pages/settings/AddModelDialog.tsx` | 「高级选项」`Collapsible` 折叠区 |
| `packages/core/src/agent/types.ts` | `ModelConfig` 补 `maxOutputTokens`（`contextWindow` 已存在） |
| `packages/core/src/agent/create-agent.ts` | 输出上限取自 `modelConfig?.maxOutputTokens`，同步给 `LoopAgent` 与 `ModelContextCompactor`；移除 `AgentConfig.maxTokens` |
| `server/src/agent/get-agent.ts` | `buildAgentConfig` 传模型级 `context_window` / `max_output_tokens` |

## 运行管线接入

模型级参数已接入 `buildAgentConfig → createAgent → LoopAgent / ModelContextCompactor`：

- **上下文窗口**：`model.context_window ?? config.model?.context_window`（模型级优先，回退全局默认），供 `ModelContextCompactor` 的 pressure 压缩预算计算使用。
- **最大输出 tokens**：`ModelConfig.maxOutputTokens = model.max_output_tokens`，同时作用于
  - `LoopAgent.callModel` 的 `ModelRequest.maxOutputTokens`（模型请求输出上限）；
  - `ModelContextCompactor` 的 `reservedCompletionTokens`（压缩预算里为 completion 预留的额度）。

`AgentConfig` 不再暴露独立的 `maxTokens` 字段，输出上限统一由模型级 `max_output_tokens` 决定；`createAgent` 内部用 `const maxTokens = modelConfig?.maxOutputTokens` 取值，模型未配置时交给 provider 默认（`reservedCompletionTokens` 为 0）。
