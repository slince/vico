/**
 * Chat 执行引擎 — 纯 Vico 写法：createAgent 注册到 Runtime，vico.stream 执行。
 */
import type {Agent, Tool, TurnEvent, TurnResult} from '@vico/agent';
import {agentManager} from '../services/agent/agent-manager.js';
import logger from '../lib/logger.js';
import {vico} from '../vico.js';
import type {AgentRuntimeConfig} from "../services/agent/types";
import {createRagSearchTool} from '../agent/tools/rag-tool.js';

export interface ExecuteChatParams {
  agentId: string;
  message: string;
  threadId: string;
  tenantId: string;
  userId: string;
}

export interface ExecuteChatResult {
  stream: AsyncGenerator<TurnEvent, TurnResult>;
}

/** 执行 Agent 对话 — 通过 vico.stream */
export async function executeAgentChat(
  params: ExecuteChatParams,
): Promise<ExecuteChatResult> {
  const { agentId, message, threadId, tenantId, userId } = params;

  if (!message?.trim()) throw new Error('Message is required');

  // 确保 Agent 已在 Vico Runtime 注册
  if (!vico.runtime.getAgent(agentId)) {
    const agentConfig = await agentManager.getAgentRuntimeConfig(tenantId, agentId);
    if (!agentConfig) throw new Error('Agent not found');
    await createAgent(agentConfig);
  }

  const stream = vico.stream(agentId, message, {
    threadId,
    userId,
    scopeId: tenantId,
  });

  return { stream };
}

/** 清空 Agent 缓存（Skill/KB 变更时调用） */
export function invalidateAgentCache(_tenantId: string, agentId: string): void {
  vico.runtime.destroy(agentId);
}

async function createAgent(runtimeConfig: AgentRuntimeConfig): Promise<Agent> {
  const { agent, model } = runtimeConfig;

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

async function loadTools(agent: any): Promise<Tool[]> {
  const tools: Tool[] = [];

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
