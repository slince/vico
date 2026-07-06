/**
 * Agent 实例获取 — 组合 DB 配置查询、AgentConfig 构建、Vico Runtime 注册。
 *
 * 服务端各处可通过 getAgent(id) 直接拿到可交互的 agent 对象。
 */
import type { AgentConfig, Tool } from '@vico/agent';
import { codingTools, filesystemTools } from '@vico/agent';
import { agentManager } from '../services/agent/agent-manager.js';
import type { BuiltinToolsConfig } from '../services/agent/types.js';
import { vico } from '../vico.js';

/** workspace 工具全集（文件系统 + coding），用于 builtin_tools 过滤 */
const workspaceTools: Tool[] = [...filesystemTools, ...codingTools];

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
  if (!builtinToolsConfig) return workspaceTools;

  return workspaceTools
    .filter((tool) => {
      const entry = builtinToolsConfig[tool.name];
      if (entry === undefined) return true;
      if (typeof entry === 'boolean') return entry;
      return entry.enabled;
    })
    .map((tool) => {
      const entry = builtinToolsConfig[tool.name];
      if (typeof entry === 'object' && entry.need_approval) {
        return { ...tool, policy: 'on-request' as const };
      }
      return tool;
    });
}

/** 将 DB 运行时配置转换为 AgentConfig */
function buildAgentConfig(
  runtimeConfig: NonNullable<Awaited<ReturnType<typeof agentManager.getAgentRuntimeConfig>>>,
): AgentConfig {
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

/**
 * 获取或注册 Vico Agent 实例（不存在则创建，全局缓存）。
 *
 * 组合 agentManager.getAgentRuntimeConfig → buildAgentConfig → vico.createIfAbsent，
 * 方便各层按 agentId 直接拿到可交互的 agent 对象。
 */
export async function getAgent(agentId: string) {
  return vico.createIfAbsent(agentId, async (): Promise<AgentConfig> => {
    const runtimeConfig = await agentManager.getAgentRuntimeConfig(agentId);
    if (!runtimeConfig) throw new Error('Agent not found');
    return buildAgentConfig(runtimeConfig);
  });
}
