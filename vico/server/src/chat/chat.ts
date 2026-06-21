/**
 * Chat 执行引擎 — 基于 Vico AgentLoop。
 */
import {
  Agent, AgentLoop, AISDKModelClient, ToolBroker,
  SystemPromptProcessor, MemoryProcessor,
  ProcessorPipeline, MittEventRecorder, InMemorySpanTracker,
  createBuiltInToolSource,
} from '@vico/agent';
import type { TurnEvent, TurnResult, ModelMessage, Tool } from '@vico/agent';
import { DrizzleThreadStore, ensureTables } from '@vico/libsql-adapter';
import { resolveModelProvider } from '../agent/bridges/model-bridge.js';
import { agentManager } from '../services/agent/agent-manager.js';
import { modelManager } from '../services/model/model-manager.js';
import { skillManager } from '../skill/manager.js';
import { getDb } from '../db/db.js';
import { TenantThreadStore } from '../agent/thread-store-wrapper.js';
import logger from '../lib/logger.js';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface ExecuteChatParams {
  agentId: string;
  message: string;
  threadId: string;
  tenantId: string;
  userId: string;
}

export interface ExecuteChatResult {
  thread: string;
  stream: AsyncGenerator<TurnEvent, TurnResult>;
}

// ---------------------------------------------------------------------------
// Agent 缓存
// ---------------------------------------------------------------------------

const agentCache = new Map<string, Agent>();

function cacheKey(tenantId: string, agentId: string): string {
  return `${tenantId}:${agentId}`;
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

export async function executeAgentChat(
  params: ExecuteChatParams,
): Promise<ExecuteChatResult> {
  const { agentId: rawAgentId, message, tenantId, userId } = params;
  let threadId: string = params.threadId;

  if (!message?.trim()) throw new Error('Message is required');

  if (threadId.startsWith('__LOCALID_')) {
    threadId = crypto.randomUUID();
  }

  const agentConfig = await agentManager.getAgentRuntimeConfig(tenantId, rawAgentId);
  if (!agentConfig) throw new Error('Agent not found');

  const key = cacheKey(tenantId, (agentConfig as any).agent.id);
  let agent = agentCache.get(key);
  if (!agent) {
    agent = await buildAgent(tenantId, userId, agentConfig!);
    agentCache.set(key, agent);
  }

  const history = await loadRecentHistory(agent.thread, threadId);
  const userMessage: ModelMessage = { role: 'user', content: message };

  const stream = agent.getLoop().runTurn(
    threadId, history, userMessage,
    new AbortController().signal,
    { userId, scopeId: tenantId },
  );

  return { thread: threadId, stream };
}

export function invalidateAgentCache(tenantId: string, agentId: string): void {
  agentCache.delete(cacheKey(tenantId, agentId));
  agentCache.delete(cacheKey(tenantId, 'main'));
}

// ---------------------------------------------------------------------------
// Agent 构建
// ---------------------------------------------------------------------------

async function buildAgent(
  tenantId: string,
  userId: string,
  runtimeConfig: NonNullable<Awaited<ReturnType<typeof agentManager.getAgentRuntimeConfig>>>,
): Promise<Agent> {
  const { agent } = runtimeConfig;

  // Model
  const modelConfig = await modelManager.getDefault(tenantId);
  if (!modelConfig) throw new Error('No LLM model configured');
  const languageModel = resolveModelProvider(modelConfig);
  const modelClient = new AISDKModelClient(
    languageModel as any,
    modelConfig.provider,
    modelConfig.model_name,
  );

  // ThreadStore
  const db = getDb();
  await ensureTables(db as any);
  const threadStore = new TenantThreadStore(tenantId, new DrizzleThreadStore({ db: db as any }));

  // Tools
  const tools = await buildTools(agent, tenantId, userId);

  // System prompt
  let systemPrompt = agent.system_prompt || '';
  try {
    const skillPrompts = await skillManager.getPromptForAgent(agent.id);
    if (skillPrompts) systemPrompt += '\n\n## 技能指南\n' + skillPrompts;
  } catch {}

  // Agent 实例
  const agentInst = new Agent({
    config: {
      id: agent.id,
      name: agent.name,
      systemPrompt,
      model: {
        provider: modelConfig.provider,
        model: modelConfig.model_name,
        baseUrl: modelConfig.base_url || undefined,
        apiKey: modelConfig.api_key || undefined,
      },
      temperature: agent.temperature ?? 0.7,
      maxTokens: agent.max_tokens ?? 4096,
      maxSteps: agent.max_steps ?? 10,
    },
    model: modelClient,
    tools,
    skills: [],
    thread: threadStore,
  });

  // Event + span infrastructure
  const events = new MittEventRecorder();
  const spanTracker = new InMemorySpanTracker();

  // Tool chain
  const toolBroker = new ToolBroker();
  if (tools.length > 0) {
    toolBroker.addSource({
      name: 'primary',
      list: async () => tools,
    });
  }
  toolBroker.addSource(createBuiltInToolSource());

  // Context processors
  const processors = [new SystemPromptProcessor()];

  // AgentLoop
  agentInst.loop = new AgentLoop({
    agent: agentInst,
    toolBroker,
    processors,
    events,
    spanTracker,
  });

  logger.info({ agentId: agent.id, name: agent.name }, 'Agent built');
  return agentInst;
}

async function buildTools(
  agent: any,
  tenantId: string,
  userId: string,
): Promise<Tool[]> {
  const tools: Tool[] = [];

  // Skill 工具
  try {
    const defs = await skillManager.getToolDefsForAgent(agent.id);
    const impls = await skillManager.getToolsForAgent(agent.id);
    for (const def of defs) {
      const impl = impls.find((t: any) => t.definition.name === def.name);
      if (!impl) continue;
      tools.push({
        name: def.name,
        description: def.description,
        inputSchema: (def.parameters || {}) as Record<string, unknown>,
        policy: 'auto' as const,
        kind: 'readonly' as const,
        tags: ['skill'],
        execute: async (call: any, ctx: any) => {
          return impl.handler(call.args, { tenantId, agentId: agent.id, userId, skillConfig: {} });
        },
      } as Tool);
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load skill tools');
  }

  // RAG 工具
  if (agent.rag_mode !== 'disabled') {
    try {
      const { createRagSearchTool } = await import('../agent/tools/rag-tool.js');
      const ragTool = await createRagSearchTool(agent);
      if (ragTool) tools.push(ragTool as unknown as Tool);
    } catch (err) {
      logger.warn({ err }, 'Failed to create RAG tool');
    }
  }

  return tools;
}

async function loadRecentHistory(
  threadStore: any,
  threadId: string,
): Promise<ModelMessage[]> {
  try {
    const existing = await threadStore.getThread(threadId);
    if (!existing) return [];
    const entries = await threadStore.getRecentEntries(threadId, 20);
    return entries.map((e: any) => ({
      role: e.role,
      content: e.content,
      ...(e.toolCallId ? { toolCallId: e.toolCallId } : {}),
      ...(e.toolCalls ? { toolCalls: e.toolCalls } : {}),
    }));
  } catch {
    return [];
  }
}
