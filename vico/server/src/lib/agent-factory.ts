/**
 * AgentFactory — 组合 DB 配置查询、AgentConfig 构建与 Vico Runtime 注册。
 *
 * 由容器以依赖注入方式装配（见 services-provider.ts）：agentManager、skill 加载器
 * 与 memory/model 配置切片均通过构造注入，不再在构建路径上触碰全局容器。
 */
import { memorySchema, modelSchema } from '@vico/boot';
import type { z } from 'zod';
import type { Agent, AgentConfig } from '@vico/agent';
import type { CompactionSettings } from '@vico/compaction';
import type { Skill } from '@vico/skill';
import { createIfAbsent } from './utils.js';
import type { AgentManager } from '../services/agent/agent-manager.js';
import type { AgentRuntimeConfig } from '../services/agent/types.js';

/** 记忆配置切片（stm_window / compaction 等） */
type MemoryConfig = z.infer<typeof memorySchema>;

/** 全局模型默认配置切片（默认上下文窗口） */
type ModelConfig = z.infer<typeof modelSchema>;

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

/**
 * Agent 实例工厂。
 *
 * 通过构造注入获取依赖：agentManager（运行时配置查询）、listSkills（skill 加载）、
 * memoryConfig / modelConfig（config.yaml 配置切片）。`create` 每次调用按 agentId
 * 查询运行时配置、构建 AgentConfig 并复用全局 LRU 缓存。
 */
export class AgentFactory {
  constructor(
    private readonly agentManager: AgentManager,
    private readonly listSkills: () => Promise<Skill[]>,
    private readonly memoryConfig: MemoryConfig,
    private readonly modelConfig: ModelConfig,
  ) {}

  /**
   * 获取或注册 Vico Agent 实例（不存在则创建，全局缓存）。
   */
  async create(agentId: string): Promise<Agent> {
    return createIfAbsent(agentId, async (): Promise<AgentConfig> => {
      const runtimeConfig = await this.agentManager.getAgentRuntimeConfig(agentId);
      if (!runtimeConfig) throw new Error('Agent not found');
      return this.buildAgentConfig(runtimeConfig);
    });
  }

  /** 将 DB 运行时配置转换为 AgentConfig */
  private async buildAgentConfig(runtimeConfig: AgentRuntimeConfig): Promise<AgentConfig> {
    const { agent: a, model, workspace } = runtimeConfig;

    // 解析 Agent 绑定的 skills：名字列表 → 全局 Skill 对象（仅启用已绑定的）
    const allSkills = await this.listSkills();
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
        contextWindow: model.context_window ?? this.modelConfig.context_window,
        // 模型级输出上限；缺失时不设上限，交给 provider 默认
        maxOutputTokens: model.max_output_tokens ?? undefined,
      },
      temperature: a.temperature ?? 0.7,
      maxSteps: a.max_steps ?? 10,
      conversationWindow: this.memoryConfig.stm_window,
      compaction: toCompactionSettings(this.memoryConfig.compaction),
      workspace,
      skills,
    };
  }
}
