# 模型设置多类型化（对话/向量/重排/视觉/语音）

## 背景

原「模型管理」页是扁平列表，只管理「对话(chat)」模型；`model_configs` 无类型字段，`is_default` 为全局唯一默认标记，提供商下拉是硬编码的 `PROVIDER_PRESETS`（5 家）。

本次升级（范围：仅设置页 + 存储，**未接入** RAG/向量化/语音等运行管线）：

- `model_configs` 新增 `model_type` 列，模型按类型落库。
- `is_default` 改为**按类型隔离**（每个类型各有一个默认模型）。
- 设置页按 5 类分 tab 展示：`chat`(对话) / `embedding`(向量) / `rerank`(重排) / `vllm`(视觉) / `asr`(语音)。
- 提供商下拉改用 `/api/v1/llm-providers`（上一轮从 `llm/providers/*.json` 拆分的 catalog 接口）。

## 关键文件

| 文件 | 职责 |
|------|------|
| `server/src/db/schema.ts` | `model_configs` 增加 `model_type text NOT NULL DEFAULT 'chat'` |
| `server/drizzle/0012_add_model_type.sql` + `meta/_journal.json` | 迁移（启动时 `runMigrations()` 自动执行） |
| `server/src/services/model/model-manager.ts` | `create`/`update` 支持 `model_type`；设默认时按 `model_type` 清同类型默认 |
| `server/src/api/providers.ts` | `GET /api/v1/llm-providers` 返回 `{ meta, providers }` |
| `web/src/pages/settings/providers.ts` | catalog 类型 + `MODEL_TYPES` + `filterProvidersByType`/`getProviderBaseUrl`/`getModelSuggestions` 纯函数 |
| `web/src/pages/settings/ModelManagement.tsx` | 类型 Tabs + 按类型列表/增删改/设默认 |
| `web/src/pages/settings/AddModelDialog.tsx` | 类型→厂商→模型名(建议)→API Key→Base URL→设默认 |
| `web/src/pages/AgentDetail.tsx` | Agent 模型选择只展示 `model_type === 'chat'` |

## catalog 数据形状要点

- `provider.model_types` 小写数组（`chat/embedding/rerank/vllm/asr`），是「厂商支持哪些类型」的权威来源。
- `provider.base_urls` 按类型 key（`base_urls.chat` / `base_urls.embedding` 等），个别厂商还有 `anthropic`/`chat_cn` 等额外 key。
- `provider.models[]` 中 `kind: 'model'|'pattern'`；**仅** embedding/rerank/asr 模型带 `model_type`（值 `Embedding`/`Rerank`/`ASR`），chat/vllm 模型无 `model_type`——因此 `getModelSuggestions` 对 chat/vllm 用「无 model_type 的 model」推断。

## 后续可做（本次未做）

- 把 embedding/rerank/vllm/asr 模型接入实际管线：RAG 向量化/重排、语音识别等（目前仍走 `config.ts` 里硬编码的 `rag.embedder` / `rerank.model`）。
- `web/src/components/assistant-ui/model-selector-action.tsx` 仍是硬编码占位模型（`gpt-6-luna` 等），可接入 `/api/v1/models` 的 chat 模型。
