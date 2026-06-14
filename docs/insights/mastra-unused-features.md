# Mastra 框架未使用功能及优化方向

> 生成日期：2026-06-14
> 基于 Mastra v1.x + 当前项目代码分析

## 一、当前 Mastra 使用概况

已使用的功能：
- **Agents**：预注册 agent（main、agent-proxy）+ 动态团队编排 agent（`stream`、`generate`、`network`）
- **Tools**：`createTool` 模式（天气、RAG、Skill 适配器、Agent 委派）
- **Memory**：`@mastra/memory`（对话历史 + 工作记忆）
- **Storage/Vector**：`LibSQLStore` + `LibSQLVector`
- **Hono 适配器**：`MastraServer` + 中间件
- **Workspace**：`LocalFilesystem` 沙箱
- **Output Processors**：Token 追踪 + 审计日志
- **RequestContext**：运行时多租户注入

---

## 二、未使用功能及优化方向

### 🔴 优先级 P0 — 生产就绪必备

#### 1. 可观测性（`@mastra/observability`）

**当前状态**：已安装依赖（^1.14.1），但未导入使用。项目无任何分布式追踪或性能监控。

**Mastra 提供**：
- 内置 OpenTelemetry 追踪（agent 调用、tool 执行、workflow 步骤）
- Token 使用量、延迟、成本追踪
- 兼容 Langfuse、SigNoz 等可观测平台

**优化方向**：
- 接入 `@mastra/observability`，导出 OTLP 数据到 Langfuse 或本地 collector
- 补充全链路 TraceId，便于排查多 agent 协作调用链
- 建立 agent 调用延迟 P50/P99 监控 dashboard

---

#### 2. Evals 评估（`@mastra/evals`）

**当前状态**：已安装依赖（^1.3.0），但未导入使用。项目无 agent 质量回归测试。

**Mastra 提供**：
- 答案相关性、完整性、语气一致性评分
- 基于模型评分 / 基于规则 / 基于统计三种评估方式
- 标准化 0-1 评分，可记录和对比
- 支持自定义 prompt 和评分函数

**优化方向**：
- 为核心 agent（main、agent-proxy）建立基准测试集
- CI 中集成 eval 回归检测，防止 prompt 变更导致质量下降
- 定期对 RAG 回答质量进行评估（relevant、faithfulness）

---

### 🟡 优先级 P1 — 功能增强

#### 3. Workflows 工作流（`@mastra/core/workflow`）

**当前状态**：未使用。项目目前使用 `agent.network()` 实现团队协作，但无持久化、多步骤、人在回路的工作流能力。

**Mastra 提供**：
- `createWorkflow()` + `createStep()` 构建 DAG 状态机
- 控制流：`.then()`、`.branch()`、`.parallel()`、`.doUntil()`/`.doWhile()`、`.foreach()`
- **人在回路（Human-in-the-loop）**：挂起执行，等待人工审批后恢复
- **自动状态持久化**：工作流可跨进程/跨重启恢复
- 内置重试、错误处理、嵌入式子工作流
- 每步自动 OpenTelemetry 追踪

**优化方向**：
- 多步骤 agent 流水线（如：分析需求 → 分配子任务 → 各 agent 执行 → 汇总审核 → 输出）
- 审批工作流（高风险操作需人工确认后才执行）
- 定时批量任务（日报生成、知识库更新等）

---

#### 4. Guardrails 护栏

**当前状态**：项目有 Output Processor（token 追踪、审计日志），但未用于安全防护。

**Mastra 提供**：
- 输入净化：防御 prompt 注入、PII 过滤
- 输出校验：防止敏感信息泄露、有害内容输出
- 工具审批：危险工具执行前可要求人工确认（项目目前仅在 SSE 层标记 `approval_required`）

**优化方向**：
- 添加输入 guardrail：检测并拒绝 prompt 注入攻击
- 添加输出 guardrail：过滤含敏感信息的 agent 响应
- 将 tool 审批机制从 SSE 层下沉到 Mastra guardrail，统一管控

---

### 🟢 优先级 P2 — 体验/效率提升

#### 5. MCP 支持

**当前状态**：未使用。项目工具均通过自定义 Skill 系统或硬编码 `createTool` 添加。

**Mastra 提供**：
- 自动发现 MCP 服务端暴露的工具
- 热加载，无需重启
- 社区生态（opentools.com、MCP.run）

**优化方向**：
- 在 Skill 系统中增加 MCP 工具源类型，用户可配置 MCP server 地址
- 通过 MCP 连接外部数据源（数据库、API）作为 agent 工具

---

#### 6. Studio UI

**当前状态**：未使用。项目有自建 Web 控制台，但无 Mastra Studio 的开发调试体验。

**Mastra 提供**：
- 本地 `localhost:4111` 交互式 playground
- 可视化 agent 聊天测试
- 执行追踪查看
- Prompt 调试优化

**优化方向**：
- 将 Studio 作为开发环境标配，降低 agent 调试门槛
- 评估是否可将 Studio 的追踪能力嵌入到管理后台

---

#### 7. RAG ETL 管道

**当前状态**：项目使用自定义 RAG 实现（手动分块 + `LibSQLVector` + 混合搜索）。未使用 Mastra 的 RAG ETL 管道。

**Mastra 提供**：
- 全 ETL：自动分块、嵌入、索引
- **GraphRAG**：更优的上下文检索
- **重排序（Reranking）**：OpenAI / Cohere 集成
- 多向量库支持：LibSQL、Pinecone、pgvector、Qdrant

**优化方向**：
- 用 Mastra RAG ETL 替换自定义分块/索引逻辑，减少维护成本
- 引入 GraphRAG 提升复杂知识库的检索质量
- 引入重排序提升 top-k 结果精度

---

#### 8. AI SDK 桥接（`@mastra/ai-sdk`）

**当前状态**：已安装依赖（^1.4.5），但项目使用 `@ai-sdk/openai` 和 `@ai-sdk/anthropic` 直接创建模型实例。

**Mastra 提供**：
- 统一的 AI SDK 模型创建包装
- 简化模型切换和配置

**优化方向**：
- 评估 `@mastra/ai-sdk` 是否能简化 `model-bridge.ts` 中的模型适配逻辑
- 如无实际收益，移除该依赖

---

### ⚪ 优先级 P3 — 远期规划

#### 9. Voice 语音

**当前状态**：未使用。

**Mastra 提供**：
- TTS：ElevenLabs / OpenAI 语音合成
- STT：语音转文字
- STS：实时语音对话

**潜在场景**：
- 移动端语音交互
- 会议纪要自动生成

---

#### 10. DuckDB（`@mastra/duckdb`）

**当前状态**：已安装依赖（^1.4.2），未导入。可能与 LibSQL 功能重叠。

**建议**：如无计划使用 DuckDB 作为分析引擎，移除该依赖。

---

## 三、未使用的依赖清理建议

以下包已安装但代码中零引用，建议评估后移除：

| 包名 | 安装版本 | 建议 |
|-------|----------|------|
| `@mastra/ai-sdk` | ^1.4.5 | 评估是否可简化 model-bridge，否则移除 |
| `@mastra/duckdb` | ^1.4.2 | 当前与 LibSQL 重叠，建议移除 |
| `@mastra/evals` | ^1.3.0 | P0 优先接入，近期即用 |
| `@mastra/loggers` | ^1.1.2 | 项目使用 pino，无切换计划则移除 |
| `@mastra/observability` | ^1.14.1 | P0 优先接入，近期即用 |

---

## 四、行动计划

| 阶段 | 任务 | 预估影响 |
|------|------|----------|
| **近期**（1-2 周） | 接入 `@mastra/observability` + Langfuse | 可观测性从 0 到 1 |
| **近期**（1-2 周） | 为核心 agent 建立 eval 测试集 | 防止 prompt 回归 |
| **中期**（1 个月） | 引入 Workflows 处理多步骤任务 | 解锁复杂业务流程 |
| **中期**（1 个月） | 添加输入/输出 Guardrails | 安全防护 |
| **远期** | MCP、RAG ETL、Voice | 生态扩展 |
