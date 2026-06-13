/**
 * Vico Agent 工厂 — 将 Vico Agent 配置转换为 Mastra Agent 实例
 *
 * 每个请求动态构造 Mastra Agent，注入:
 * - instructions: Agent system_prompt + Skill prompts
 * - model: 根据 model_configs 表解析的 AI SDK model 实例
 * - tools: Skill 工具 + RAG 工具
 * - memory: 共享的 Mastra Memory 实例
 * - processors: 审计日志 + Token 跟踪
 */
import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { eq, and } from 'drizzle-orm';
import type { MastraModelConfig } from '@mastra/core/llm';
import type { InputProcessorOrWorkflow, OutputProcessorOrWorkflow } from '@mastra/core/processors';
import { getDb, schema } from '../db/db.js';
import { getDefaultModel, type ModelConfigRow } from './model-registry.js';
import { skillManager } from '../skill/manager.js';
import { getMemory } from './memory-setup.js';
import { getSkillToolsForMastraAgent } from './tools/skill-tool-adapter.js';
import { createRagSearchTool } from './tools/rag-tool.js';
import { createAuditLogger } from './processors/audit-logger.js';
import { createTokenTracker } from './processors/token-tracker.js';

const { agents } = schema;

/**
 * 根据 Vico model_configs 行创建 AI SDK LanguageModel。
 *
 * 支持的 provider:
 * - openai, deepseek, qwen, custom → 通过 createOpenAI() 创建（OpenAI 兼容协议）
 * - anthropic → 通过 createAnthropic() 创建
 *
 * @param modelConfig - 来自 model_configs 表的模型配置行
 * @returns AI SDK LanguageModel 实例，可直接传入 Mastra Agent 的 model 配置
 */
export function resolveModelProvider(modelConfig: ModelConfigRow): MastraModelConfig {
  const apiKey = modelConfig.api_key_encrypted;
  const baseURL = modelConfig.base_url || undefined;

  switch (modelConfig.provider) {
    case 'anthropic':
      // @ai-sdk/anthropic v1: createAnthropic 返回 ProviderV1, 调用 (modelId) 返回 LanguageModelV1
      return createAnthropic({ apiKey, baseURL })(modelConfig.model_name);
    case 'deepseek':
    case 'qwen':
    case 'custom':
      // OpenAI 兼容 provider — 使用 createOpenAI 指定自定义 base URL
      // @ai-sdk/openai v3: createOpenAI 返回 ProviderV3, .chat(modelId) 返回 LanguageModelV3
      return createOpenAI({ apiKey, baseURL }).chat(modelConfig.model_name);
    case 'openai':
    default:
      return createOpenAI({ apiKey, baseURL }).chat(modelConfig.model_name);
  }
}

/** 创建 Mastra Agent 所需的运行时上下文 */
export interface AgentContext {
  /** 租户 ID，用于多租户数据隔离 */
  tenantId: string;
  /** Agent ID */
  agentId: string;
  /** 当前用户 ID */
  userId: string;
}

/**
 * 根据 Vico Agent 配置创建 Mastra Agent 实例。
 *
 * 执行流程:
 * 1. 从 agents 表加载 Agent 配置
 * 2. 解析 model_configs 表中的默认模型为 AI SDK LanguageModel
 * 3. 构建 instructions: Agent system_prompt + 绑定的 Skill prompts
 * 4. 构建 tools: Skill 工具 + RAG 知识库检索工具
 * 5. 注入共享的 Mastra Memory（LibSQL 持久化 + 语义召回）
 * 6. 注册 output processors（审计日志、Token 跟踪）
 *
 * @param ctx - 运行时上下文（tenantId, agentId, userId）
 * @returns Mastra Agent 实例
 */
export async function createAgent(ctx: AgentContext): Promise<Agent> {
  const db = getDb();

  // 1. 加载 Vico Agent 配置
  const agentRow = await db.select().from(agents)
    .where(and(eq(agents.id, ctx.agentId), eq(agents.tenant_id, ctx.tenantId)))
    .get();
  if (!agentRow) throw new Error('Agent not found');

  // 2. 解析模型
  const modelConfig = await getDefaultModel(ctx.tenantId);
  if (!modelConfig) throw new Error('No LLM model configured');
  const model = resolveModelProvider(modelConfig);

  // 3. 构建 instructions
  const skillPrompts = await skillManager.getPromptForAgent(ctx.agentId);
  let instructions = agentRow.system_prompt || '';
  if (skillPrompts) {
    instructions += '\n\n## 技能指南\n' + skillPrompts;
  }

  // 4. 构建 tools
  const skillTools = await getSkillToolsForMastraAgent(ctx.agentId, {
    tenantId: ctx.tenantId,
    agentId: ctx.agentId,
    userId: ctx.userId,
    skillConfig: {},
  });

  const tools: Record<string, any> = { ...skillTools };

  // RAG 知识库检索工具（如果启用）
  if (agentRow.rag_mode !== 'disabled') {
    const ragTool = await createRagSearchTool(ctx.agentId, ctx.tenantId);
    if (ragTool) {
      tools[ragTool.id] = ragTool;
    }
  }

  // 5. 共享 Memory
  const memory = getMemory();

  // 6. Processors
  const inputProcessors: InputProcessorOrWorkflow[] = [];
  const outputProcessors: OutputProcessorOrWorkflow[] = [
    createAuditLogger({
      tenantId: ctx.tenantId,
      agentId: ctx.agentId,
    }),
    createTokenTracker({
      tenantId: ctx.tenantId,
      agentId: ctx.agentId,
      modelName: modelConfig.model_name,
    }),
  ];

  // 7. 创建 Mastra Agent
  return new Agent({
    id: `vico-agent-${ctx.agentId}`,
    name: agentRow.name,
    instructions,
    model,
    tools,
    memory,
    inputProcessors,
    outputProcessors,
    maxRetries: 0,
    defaultOptions: {
      maxSteps: agentRow.max_steps ?? 10,
    },
  });
}
