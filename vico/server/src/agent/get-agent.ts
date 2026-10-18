/**
 * Agent 实例获取 — 组合 DB 配置查询、AgentConfig 构建、Vico Runtime 注册。
 *
 * 服务端各处可通过 getAgent(id) 直接拿到可交互的 agent 对象。
 */
import type {AgentConfig} from '@vico/agent';
import type {CompactionSettings} from '@vico/compaction';
import {memorySchema} from '@vico/boot';
import type {z} from 'zod';
import {createIfAbsent, listSkills} from '../vico.js';
import type {AgentRuntimeConfig} from "../services/agent/types";
import {getContainer} from '../container.js';

type MemoryConfig = z.infer<typeof memorySchema>;

/** config.yaml 的 snake_case compaction 配置 → core CompactionSettings（camelCase） */
function toCompactionSettings(raw: MemoryConfig['compaction']): Partial<CompactionSettings> | undefined {
  if (!raw) return undefined;
  return {
    auto: raw.auto,
    thresholdRatio: raw.threshold_ratio,
    headroomTokens: raw.headroom_tokens,
    retainRatio: raw.retain_ratio,
    retainTokens: raw.retain_tokens,
    summarizationProvider: raw.summarization_provider,
    summarizationModel: raw.summarization_model,
    maxTokens: raw.max_tokens,
    compactionRetries: raw.compaction_retries,
    maxOverflowRetries: raw.max_overflow_retries,
  };
}

/** 将 DB 运行时配置转换为 AgentConfig */
async function buildAgentConfig(runtimeConfig: AgentRuntimeConfig): Promise<AgentConfig> {
  const { agent: a, model, workspace } = runtimeConfig;
  const memoryConfig = getContainer().getConfig('memory');
  const modelConfig = getContainer().getConfig('model');

  // 解析 Agent 绑定的 skills：名字列表 → 全局 Skill 对象（仅启用已绑定的）
  const allSkills = await listSkills();
  const boundNames = new Set(a.skills ?? []);
  const skills = allSkills.filter((s) => boundNames.has(s.name));

  return {
    id: a.id,
    name: a.name,
    systemPrompt: a.system_prompt,
    model: {
      provider: model.provider,
      model: model.model_name,
      baseUrl: model.base_url,
      apiKey: model.api_key,
      // 模型级上下文窗口优先，缺失时回退全局默认（provider v4 不暴露 contextWindow）
      contextWindow: model.context_window ?? modelConfig.context_window,
      // 模型级输出上限；缺失时不设上限，交给 provider 默认
      maxOutputTokens: model.max_output_tokens ?? undefined,
    },
    temperature: a.temperature ?? 0.7,
    maxSteps: a.max_steps ?? 10,
    conversationWindow: memoryConfig.stm_window,
    compaction: toCompactionSettings(memoryConfig.compaction),
    workspace,
    skills,
  };
}

/**
 * 获取或注册 Vico Agent 实例（不存在则创建，全局缓存）。
 *
 * 组合 agentManager.getAgentRuntimeConfig → buildAgentConfig → createIfAbsent，
 * 方便各层按 agentId 直接拿到可交互的 agent 对象。
 */
export async function getAgent(agentId: string) {
  const agentManager = getContainer().resolve('agentManager');
  return createIfAbsent(agentId, async (): Promise<AgentConfig> => {
    const runtimeConfig = await agentManager.getAgentRuntimeConfig(agentId);
    if (!runtimeConfig) throw new Error('Agent not found');
    return buildAgentConfig(runtimeConfig!);
  });
}
