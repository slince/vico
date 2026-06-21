/**
 * Chat 执行引擎 — 通过 Vico 标准 API 创建 Agent 并执行对话。
 *
 * 流程：
 *   loadConfig → buildTools → vico.createAgent(config) → 缓存
 *   → agent.getLoop().runTurn()  ← Vico 自动注入所有处理器和工具
 *
 * Vico 自动处理：
 *  - ModelClient 创建（defaultModelFactory）
 *  - SystemPromptProcessor + MemoryProcessor + SkillProcessor
 *  - Memory 工具（updateWorkingMemory）+ 内置工具（文件/搜索等）
 *  - EventRecorder + SpanTracker（全局共享）
 */
import {
  type TurnEvent, type TurnResult, type ModelMessage, type Tool,
  type ToolStore, type ThreadStore,
} from '@vico/agent';
import { DrizzleThreadStore } from '@vico/libsql-adapter';
import { agentManager } from '../services/agent/agent-manager.js';
import { modelManager } from '../services/model/model-manager.js';
import { getDb } from '../db/db.js';
import { TenantThreadStore } from '../agent/thread-store-wrapper.js';
import { vico } from '../vico.js';
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
// Agent 缓存（key = tenantId:agentId）
// ---------------------------------------------------------------------------

const agentCache = new Map<string, { agent: import('@vico/agent').Agent; thread: TenantThreadStore }>();

function cacheKey(tenantId: string, agentId: string): string {
  return `${tenantId}:${agentId}`;
}

/** 清空租户 Agent 缓存（Skill/KB 变更时调用） */
export function invalidateAgentCache(tenantId: string, agentId: string): void {
  agentCache.delete(cacheKey(tenantId, agentId));
  agentCache.delete(cacheKey(tenantId, 'main'));
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

  // 前端占位符 → 真实 UUID
  if (threadId.startsWith('__LOCALID_')) {
    threadId = crypto.randomUUID();
  }

  const agentConfig = await agentManager.getAgentRuntimeConfig(tenantId, rawAgentId);
  if (!agentConfig) throw new Error('Agent not found');

  const key = cacheKey(tenantId, rawAgentId);
  let cached = agentCache.get(key);
  if (!cached) {
    cached = await createAgentWithVico(tenantId, userId, agentConfig);
    agentCache.set(key, cached);
  }

  const { agent, thread: threadStore } = cached;

  // 加载历史消息
  const history = await loadRecentHistory(threadStore, threadId);
  const userMessage: ModelMessage = { role: 'user', content: message };

  // Vico AgentLoop — 所有 processor + 工具已由 Vico 注入
  const stream = agent.getLoop().runTurn(
    threadId, history, userMessage,
    new AbortController().signal,
    { userId, scopeId: tenantId },
  );

  return { thread: threadId, stream };
}

// ---------------------------------------------------------------------------
// 通过 Vico 创建 Agent
// ---------------------------------------------------------------------------

async function createAgentWithVico(
  tenantId: string,
  userId: string,
  runtimeConfig: NonNullable<Awaited<ReturnType<typeof agentManager.getAgentRuntimeConfig>>>,
): Promise<{ agent: import('@vico/agent').Agent; thread: TenantThreadStore }> {
  const { agent } = runtimeConfig;

  // 模型配置
  const modelConfig = await modelManager.getDefault(tenantId);
  if (!modelConfig) throw new Error('No LLM model configured');

  // ThreadStore（多租户隔离 + 持久化，表已由 initVico 创建）
  const db = getDb();
  const threadStore = new TenantThreadStore(
    tenantId,
    new DrizzleThreadStore({ db: db as any }),
  );

  // Tools（Skill + RAG）→ ToolStore
  const tools = await buildTools(agent, tenantId, userId);

  // System prompt（base + Skill 提示词）
  let systemPrompt = agent.system_prompt || '';
  try {
    const { skillManager } = await import('../skill/manager.js');
    const skillPrompts = await skillManager.getPromptForAgent(agent.id);
    if (skillPrompts) systemPrompt += '\n\n## 技能指南\n' + skillPrompts;
  } catch {}

  // 通过 Vico 创建 Agent → 自动构建 ModelClient + AgentLoop + 全部 processor + 工具
  const agentInst = await vico.createAgent({
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
    tools: asToolStore(tools),
    skills: { load: async () => [] },
    thread: threadStore as ThreadStore,
  });

  logger.info({ agentId: agent.id, name: agent.name }, 'Agent created via Vico');
  return { agent: agentInst, thread: threadStore };
}

// ---------------------------------------------------------------------------
// 工具构建
// ---------------------------------------------------------------------------

async function buildTools(
  agent: any,
  tenantId: string,
  userId: string,
): Promise<Tool[]> {
  const tools: Tool[] = [];

  // Skill 工具
  try {
    const { skillManager } = await import('../skill/manager.js');
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

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 将 Tool[] 包装为 Vico ToolStore */
function asToolStore(tools: Tool[]): ToolStore {
  return { load: async () => tools };
}

/** 加载 thread 中最近的历史消息 */
async function loadRecentHistory(
  threadStore: TenantThreadStore,
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
