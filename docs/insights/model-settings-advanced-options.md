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

## 范围与后续可做（本次未做）

与 [[model-settings-multi-type]] 一致，本次**仅设置页 + 存储，未接入运行管线**：

- 压缩判定仍走 `config.model.context_window`（`server/src/agent/get-agent.ts` 的 `contextWindow`），未使用 `model_configs.context_window`。
- 生成上限仍走 agent 的 `max_tokens`，未使用 `model_configs.max_output_tokens`。

后续可在 `buildAgentConfig` 中让模型级 `context_window` 覆盖全局默认、`max_output_tokens` 作为该模型输出上限（或 agent 默认值），再落一份说明。
