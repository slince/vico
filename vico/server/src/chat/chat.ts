/**
 * Chat 执行引擎 — 纯 Vico 写法：createAgent 注册到 Runtime，runTurn 执行。
 */
import {type Agent, type ModelMessage, type Tool, type TurnEvent, type TurnResult} from '@vico/agent';
import {agentManager} from '../services/agent/agent-manager.js';
import logger from '../lib/logger.js';
import {vico} from '../vico.js';
import type {AgentRuntimeConfig} from "../services/agent/types";
import {createRagSearchTool} from '../agent/tools/rag-tool.js';

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
// 公共 API
// ---------------------------------------------------------------------------

export async function executeAgentChat(
  params: ExecuteChatParams,
): Promise<ExecuteChatResult> {
  const { agentId, message, tenantId, userId } = params;
  let threadId: string = params.threadId;

  if (!message?.trim()) throw new Error('Message is required');
  if (threadId.startsWith('__LOCALID_')) threadId = crypto.randomUUID();

  // 从 Vico Runtime 获取或创建 Agent（Vico 自带 LRU 缓存）
  let agent = vico.runtime.getAgent(agentId);
  if (!agent) {
    const agentConfig = await agentManager.getAgentRuntimeConfig(tenantId, agentId);
    if (!agentConfig) throw new Error('Agent not found');
    agent = await createAgentWithVico(agentConfig);
  }

  const userMessage: ModelMessage = { role: 'user', content: message };

  const stream = agent.getLoop().runTurn(
    threadId, [], userMessage,
    new AbortController().signal,
    { userId, scopeId: tenantId },
  );

  return { thread: threadId, stream };
}

/** 清空 Agent 缓存（Skill/KB 变更时调用） */
export function invalidateAgentCache(_tenantId: string, agentId: string): void {
  vico.runtime.destroy(agentId);
}

// ---------------------------------------------------------------------------
// 通过 Vico 创建 Agent
// ---------------------------------------------------------------------------

async function createAgentWithVico(runtimeConfig: AgentRuntimeConfig): Promise<Agent> {
  const { agent, model } = runtimeConfig;

  // 加载 Agent 绑定的 Skill 工具 + RAG 工具
  const tools = await loadTools(agent);

  return vico.createAgent({
    id: agent.id,
    name: agent.name,
    systemPrompt: agent.system_prompt || '',
    model: {
      provider: model.provider,
      model: model.model_name,
      baseUrl: model.base_url || undefined,
      apiKey: model.api_key || undefined,
    },
    temperature: agent.temperature ?? 0.7,
    maxTokens: agent.max_tokens ?? 4096,
    maxSteps: agent.max_steps ?? 10,
    tools: { load: async () => tools },
    skills: { load: async () => [] },
    thread: vico.thread,
  });
}

// ---------------------------------------------------------------------------
// 工具加载
// ---------------------------------------------------------------------------

async function loadTools(agent: any): Promise<Tool[]> {
  const tools: Tool[] = [];

  // RAG 工具
  if (agent.rag_mode !== 'disabled') {
    try {
      const ragTool = await createRagSearchTool(agent);
      if (ragTool) tools.push(ragTool as unknown as Tool);
    } catch (err) {
      logger.warn({ err }, 'Failed to create RAG tool');
    }
  }

  return tools;
}
