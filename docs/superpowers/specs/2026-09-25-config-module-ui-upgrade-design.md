# 配置模块 UI 升级 设计

> 设计日期：2026-09-25
> 范围：Settings 页 + Agent 详情配置面板；借鉴 WeKnora 配置区（`~/www/js/weknora/frontend/src/views/settings/`）

## 背景与目标

Vico 当前的「配置模块」很薄：

- `vico/web/src/pages/Settings.tsx` — 单页 + 两个 Tab：`通用设置`（仅语言）、`LLM 模型`（模型列表 Card）
- `vico/web/src/pages/settings/` — `AddModelDialog.tsx`、`LanguageSwitcher.tsx`
- `vico/web/src/pages/agent-detail/` — `ConfigPanel`（系统提示词/模型/温度/max_tokens/rag_mode）、`SkillPanel`、`KnowledgePanel`

而运行时配置目前只存在于 `server.config.yaml`，`config.ts` 启动时 `loadConfig()` 一次性读成模块级常量 `config`，**没有 settings API、没有 settings 表、没有运行时读写能力**。

本轮目标：

1. 把 Settings 页从「两个 Tab」升级为「**左侧分组导航 + 右侧内容**」的壳（借鉴 WeKnora 的导航壳，非弹窗壳——vico 已有全站 Sidebar）。
2. **扩展新配置项**：新增 记忆 / 检索(RAG) / 工具与执行 等 section，需后端配套的运行时配置读写能力，且**保存后即时生效**。
3. Agent 详情配置面板**保留 Tabs**，仅做样式统一。

非目标：

- 模型列表不换成 WeKnora 的「卡片网格」（沿用现有 Card 列表）。
- 存储 / 系统信息 section v1 只做**只读展示**。
- 深色主题切换列为可选 Phase 3，不在本轮主线。

## 核心决策

| 项 | 决策 |
|---|---|
| 持久化 | 新建 `settings` 表（KV + 元数据），对齐 WeKnora `system_settings` 风格 |
| 解析层级 | 3 层：DB 行 > 环境变量 > 内置默认（照搬 WeKnora） |
| 服务形态 | `SettingsService` 模块级单例 + 注册表（key → default/env/zod/category/description/value_type/enum） |
| 生效方式 | 即时生效：多数消费者「读时取值」，状态型消费者订阅重建 |
| 配置项分层 | 可运行时编辑（memory/rag/tool/upload/checkpoint.ttl_days） vs 部署期只读（port/db/skills.scan_paths/workspace 安全项/storage 密钥） |
| 前端壳 | 左侧分组导航 + 右侧内容，in-page；`/settings?section=` deep-link |
| Agent 详情 | 保留 Tabs（配置/Skill/知识/对话），仅样式统一 |
| 迁移 | drizzle-kit generate + **同步更新 `_journal.json`**，`migrate()` 需 `await`（已知坑） |

## 数据模型

`vico/server/src/db/schema.ts` 新增 `settings` 表：

```typescript
/** 运行时配置 KV 表（对齐 WeKnora system_settings）。value 存 JSON 字符串。 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),          // 自然键，如 'memory.stm_window'
  value: text('value').notNull(),         // JSON 字符串
  valueType: text('value_type').notNull(),// 'string' | 'number' | 'boolean' | 'string[]' | 'object'
  category: text('category').notNull(),   // 分组：appearance/general/memory/rag/tool/storage/system
  description: text('description').notNull().default(''),
  isSecret: integer('is_secret').notNull().default(0),
  requiresRestart: integer('requires_restart').notNull().default(0), // 预留
  updatedAt: integer('updated_at').notNull(),                        // Date.now()
});
```

说明：

- `key` 用自然键做主键（KV 表语义，避免额外 uuid 查询；与实体表的 `uuid()` 主键约定不同，是刻意为之）。
- `value_type` + `category` + `description` 是**元数据驱动**的关键：前端据此自动选控件（InputNumber / Select / Switch / Slider），加新配置项只需注册表加一条、不碰表结构。

## 服务层

新目录 `vico/server/src/services/settings/`（或 `settings/`）。

### 注册表

```typescript
/** 单个配置项的注册信息 */
interface SettingDef {
  default: unknown;
  env?: string;              // 环境变量名，用于 3 层解析
  schema: z.ZodType;         // 写时校验
  category: SettingCategory;
  description: string;
  valueType: 'string' | 'number' | 'boolean' | 'string[]' | 'object';
  enum?: string[];           // 有则前端渲染 Select
  isSecret?: boolean;
  requiresRestart?: boolean;
}

/** 全部可配置项的注册表（静态声明，作为「默认值 + 环境变量 + 校验」的单一来源） */
const SETTING_REGISTRY: Record<string, SettingDef> = { /* ... */ };
```

### SettingsService 单例

- `list()` — 返回 effective 值 + 元数据（前端渲染用），secret 值掩码
- `get(key)` / `getSection(category)` — 内部消费者读 effective 值
- `update(key, value)` — `schema.parse` 校验 → 持久化 DB → 更新内存缓存 → 通知订阅者
- `subscribe(fn)` — 极简订阅（供状态型消费者 reconfigure）
- 3 层解析：`DB 行 > env > default`（`get` 时实时计算，DB 命中则覆盖 default）

## 配置项清单与分层

| 分组 category | 配置项 | valueType | 可编辑 |
|---|---|---|---|
| appearance 外观 | `appearance.theme`（client 端 localStorage） | string(enum) | ✅ |
| general 通用 | `general.language`（client 端，现有） | string(enum) | ✅ |
| memory 记忆 | `memory.stm_window` | number | ✅ |
| memory 记忆 | `memory.ltm_auto_extract` | boolean | ✅ |
| memory 记忆 | `memory.ltm_max_entries` | number | ✅ |
| rag 检索 | `rag.chunk_size` | number | ✅ |
| rag 检索 | `rag.chunk_overlap` | number | ✅ |
| rag 检索 | `rag.retrieval_top_k` | number | ✅ |
| rag 检索 | `rag.similarity_threshold` | number | ✅ |
| rag 检索 | `rag.rerank.enabled` / `rag.rerank.model` | boolean / string | ✅ |
| rag 检索 | `rag.no_match.strategy` / `rag.no_match.fallback_message` | string(enum) / string | ✅ |
| rag 检索 | `rag.query_rewrite.enabled` | boolean | ✅ |
| tool 工具 | `tool.timeout_ms` | number | ✅ |
| tool 工具 | `upload.max_size_bytes` | number | ✅ |
| tool 工具 | `workspace.timeout_ms` | number | ✅ |
| storage 存储 | `storage.type` / `storage.root` / s3(secret) | — | 🔒 只读展示 |
| system 系统 | `server.port` / `server.deploy_mode` / `db`(masked) / `skills.scan_paths` / `checkpoint.ttl_days` | — | 🔒 只读（`checkpoint.ttl_days` 可编辑） |

安全敏感项（`workspace.base_path`/`isolation`/`allowed_paths`、`database.url`、s3 密钥）**不进可编辑面**，只读或掩码。

> 澄清：`appearance.theme` 与 `general.language` 是**纯前端**偏好（localStorage），**不进 `settings` 表、不走 `SettingsService`**；其余（memory/rag/tool/storage/system）才是后端运行时配置。表内「可编辑」仅指后端项。rag 项的默认值来源是 `config.rag` + `DEFAULT_RAG_CONFIG`（`config.ts`）两者。

## 即时生效改造

`config` 常量保留为「默认值来源」（`loadConfig()` 结果喂给注册表 default），消费者改从 `settingsService` 读。

已知消费者（`grep import config`）：

- 启动类：`app.ts`、`index.ts`、`vico.ts`、`db/init-libsql.ts`（端口/db 等部署期，**保持读 config，不改**）
- `memory/embedder.ts` — embedder 选择（部署期，保持）
- `memory/memory-setup.ts` — `getMemory()` 里 `ConversationHistoryMemory(getThreadStore(), config.memory.stm_window)`（`stm_window` 在构造时传入）
- `memory/rag.ts` — `ragManager`（chunk/retrieval 参数）
- `services/agent/agent-manager.ts`、`services/knowledge/knowledge-manager.ts`、`services/knowledge/storage-manager.ts`

生效策略：

1. **读时取值**（多数项）：`rag.*`、`tool.timeout_ms`、`upload.max_size_bytes`、`checkpoint.ttl_days`、`ltm_auto_extract`/`ltm_max_entries` —— 这些本来就在每次使用时读取，改从 `settingsService.getSection(...)` 取值即可，无需订阅。
2. **状态型 reconfigure**（`stm_window`）：`ConversationHistoryMemory` 是 `@vico/core` 里的滑动窗口视图（底层是 `LibSqlThreadStore`，消息已持久化），窗口大小构造时注入。方案：`settingsService.subscribe` 收到 `memory.stm_window` 变更时，将 `_memoryStore` 置空重建（`getMemory()` 惰性重建，重读持久化消息，不丢数据）。不引入 `@vico/core` 的运行时 setter。

## API

新文件 `vico/server/src/api/settings.ts`，挂到 router：

- `GET /api/v1/settings` → 全量设置（effective 值 + 元数据：value_type/category/description/enum/is_secret/requires_restart）
- `PATCH /api/v1/settings/:key` → 更新单个；zod 校验失败返回 4xx

路由层规范：每个 handler 首行 `getAuthContext(c)`，不做业务逻辑，异常自然冒泡。

## 前端

`vico/web/src/pages/Settings.tsx` 重写为壳：

- 布局：左侧分组导航（分组标题 + 项 + active 态）+ 右侧内容，in-page
- 分组：外观与通用 / 模型 / 知识与记忆 / 工具与执行 / 系统
- 路由：`/settings?section=memory` deep-link + URL 同步（`useSearchParams`）

新增 section 组件（`vico/web/src/pages/settings/` 下）：

- `AppearanceSettings.tsx` — 语言（现有）+ 主题（新增，需 ThemeProvider）
- `MemorySettings.tsx` / `RagSettings.tsx` / `ToolSettings.tsx`
- `StorageSettings.tsx`（只读）、`SystemInfo.tsx`（只读）
- `LLM 模型` 现有逻辑迁入新壳（列表沿用 Card 列表）

规范遵守：

- 复用 shadcn Card；按 `value_type`/`enum` 渲染 Input/Select/Switch/Slider
- 每个 section 覆盖 加载(Skeleton)/空(Empty)/错误/正常 四态
- 导入顺序 React → 第三方 → API/Hooks → UI → 子组件 → 类型

### 主题（可选 Phase 3）

vico 已配好 Tailwind 4 `class` 策略（`@custom-variant dark (&:is(.dark *))`），主题切换只需新增 ThemeProvider 切换 `<html>.dark` + 持久化 localStorage。列为 Phase 3。

### Agent 详情

`vico/web/src/pages/AgentDetail.tsx` 保留 Tabs（配置/Skill/知识/对话），仅对 `ConfigPanel`/`SkillPanel`/`KnowledgePanel` 做样式统一，不改交互结构。

## 错误处理 / 测试

- `SettingsService.update` zod 校验失败 → 抛错 → 路由层冒泡 → 4xx + 前端 toast（`sonner`）
- 单测：`SettingsService` 的 3 层解析（DB/env/default）+ zod 校验 + secret 掩码
- 前端 section 组件走 `pnpm eval:ci` 冒烟；核心 service 可补单元测试

## 分阶段

- **Phase 1（后端）**：`settings` 表 + 迁移 + `SettingsService` + `settings.ts` API + 热生效改造（memory/rag/tool 消费者改读 settingsService）
- **Phase 2（前端）**：Settings 壳（左侧分组导航）+ 新 section 组件 + Agent 详情样式统一
- **Phase 3（可选）**：深色主题切换

## 关联文档

- 架构：[docs/architecture.md](../architecture.md)
- 后端规范：[docs/ts-server-best-practices.md](../ts-server-best-practices.md)
- 前端规范：[docs/react-best-practices.md](../react-best-practices.md)
- 迁移陷阱（memory）：`_journal.json` 需同步更新，`migrate()` 需 `await`
