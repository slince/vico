/**
 * Chat 执行引擎 — 纯 Vico 写法：createAgent 注册到 Runtime，vico.stream 执行。
 */
import type {AgentConfig, TurnOutput, Tool} from '@vico/agent';
import {fileBuiltinTools} from '@vico/agent';
import {agentManager} from '../services/agent/agent-manager.js';
import type {BuiltinToolsConfig} from '../services/agent/types.js';
import {vico} from '../vico.js';

export interface ExecuteChatParams {
  agentId: string;
  message: string;
  threadId: string;
  tenantId: string;
  userId: string;
}

export interface ExecuteResumeParams {
  agentId: string;
  threadId: string;
  turnId: string;
  approvalDecisions: Array<{ toolCallId: string; approved: boolean }>;
  tenantId: string;
  userId: string;
}

/**
 * 根据 builtin_tools 配置过滤并调整文件工具。
 *
 * - 未在配置中出现的工具默认启用
 * - `true` / `{ enabled: true }` → 启用
 * - `false` / `{ enabled: false }` → 禁用
 * - `{ need_approval: true }` → 覆盖策略为 on-request
 */
function resolveFileTools(
  builtinToolsConfig: BuiltinToolsConfig | undefined,
): Tool[] {
  if (!builtinToolsConfig) return fileBuiltinTools;

  return fileBuiltinTools
    .filter((tool) => {
      const entry = builtinToolsConfig[tool.name];
      if (entry === undefined) return true; // 未配置，默认启用
      if (typeof entry === 'boolean') return entry;
      return entry.enabled !== false;
    })
    .map((tool) => {
      const entry = builtinToolsConfig[tool.name];
      if (typeof entry === 'object' && entry.need_approval) {
        return { ...tool, policy: 'on-request' as const };
      }
      return tool;
    });
}

/** 构建 AgentConfig 的公共工厂 */
function buildAgentConfig(runtimeConfig: NonNullable<Awaited<ReturnType<typeof agentManager.getAgentRuntimeConfig>>>): AgentConfig {
  const { agent: a, model, workspace, builtin_tools } = runtimeConfig;
  return {
    id: a.id,
    name: a.name,
    systemPrompt: a.system_prompt,
    model: {
      provider: model.provider,
      model: model.model_name,
      baseUrl: model.base_url,
      apiKey: model.api_key,
    },
    temperature: a.temperature ?? 0.7,
    maxTokens: a.max_tokens ?? 4096,
    maxSteps: a.max_steps ?? 10,
    workspace,
    fileTools: resolveFileTools(builtin_tools),
  };
}

/** 执行 Agent 对话 — 通过 vico.stream */
export async function executeAgentChat(
  params: ExecuteChatParams,
): Promise<TurnOutput> {
  const { agentId, message, threadId, tenantId, userId } = params;

  if (!message?.trim()) throw new Error('Message is required');

  // 确保 Agent 已在 Vico Runtime 注册（不存在则创建）
  const agent = await vico.createIfAbsent(agentId, async (): Promise<AgentConfig> => {
    const runtimeConfig = await agentManager.getAgentRuntimeConfig(tenantId, agentId);
    if (!runtimeConfig) throw new Error('Agent not found');
    return buildAgentConfig(runtimeConfig);
  });

  return agent.stream(message, {
    threadId,
    userId,
    scopeId: tenantId,
  });
}

/** 恢复已暂停的 turn */
export async function executeAgentResume(
  params: ExecuteResumeParams,
): Promise<TurnOutput> {
  const { agentId, threadId, turnId, approvalDecisions, tenantId, userId } = params;

  // 确保 Agent 已在 Vico Runtime 注册（不存在则创建）
  const agent = await vico.createIfAbsent(agentId, async (): Promise<AgentConfig> => {
    const runtimeConfig = await agentManager.getAgentRuntimeConfig(tenantId, agentId);
    if (!runtimeConfig) throw new Error('Agent not found');
    return buildAgentConfig(runtimeConfig);
  });

  return agent.resumeTurn({
    threadId,
    turnId,
    approvalDecisions,
    userId,
    scopeId: tenantId,
  });
}
