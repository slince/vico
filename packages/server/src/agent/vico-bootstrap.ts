// src/agent/vico-bootstrap.ts
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { AgentRuntime, type AgentFactory } from '@vico/agent';
import { AISDKModelClient } from '@vico/agent';
import { LocalToolHost } from '@vico/agent';
import { SkillManager } from '@vico/agent';
import { FSSkillLoader } from '@vico/agent';
import { AgentLoop } from '@vico/agent';
import { PromptAssembler } from '@vico/agent';
import { MittEventRecorder, InMemorySpanTracker } from '@vico/agent';
import { CompositeHookRunner } from '@vico/agent';
import type { AgentConfig } from '@vico/agent';
import type { AgentDetail } from '../services/agent/types.js';

/** 从 ModelRef 创建 AI SDK LanguageModel */
function createLanguageModel(modelRef: AgentConfig['model']): LanguageModel {
  const apiKey = modelRef.apiKey ?? undefined;
  const baseURL = modelRef.baseUrl ?? undefined;
  const provider = modelRef.provider.toLowerCase();

  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL })(modelRef.model);
    case 'deepseek':
    case 'qwen':
    case 'custom':
    case 'openai':
    default:
      return createOpenAI({ apiKey, baseURL }).chat(modelRef.model);
  }
}

/**
 * Vico Bootstrap — 使用 @vico/agent 替代 Mastra 的 Agent 运行时。
 * 单例启动，管理 AgentRuntime + ToolHost + SkillManager 生命周期。
 */
export class VicoBootstrap {
  private runtime!: AgentRuntime;
  private toolHost!: LocalToolHost;
  private skillManager!: SkillManager;
  private events = new MittEventRecorder();
  private spanTracker = new InMemorySpanTracker();

  async init(skillRoots: string[]): Promise<void> {
    // 1. 工具系统
    this.toolHost = new LocalToolHost();

    // 2. Skill 系统
    const loader = new FSSkillLoader();
    this.skillManager = new SkillManager(loader);
    await this.skillManager.discover(skillRoots);

    // 3. Agent 运行时
    const self = this;
    const factory: AgentFactory = async (config: AgentConfig) => {
      const languageModel = createLanguageModel(config.model);
      const modelClient = new AISDKModelClient(languageModel, config.model.provider, config.model.model);
      const promptAssembler = new PromptAssembler();
      const hooks = new CompositeHookRunner();

      const loop = new AgentLoop({
        config,
        model: modelClient,
        toolHost: self.toolHost,
        promptAssembler,
        events: self.events,
        spanTracker: self.spanTracker,
        hooks,
      });

      return { config, loop };
    };

    this.runtime = new AgentRuntime(factory);
  }

  /** 根据 DB AgentDetail 创建 Vico AgentConfig */
  static toAgentConfig(detail: AgentDetail): AgentConfig {
    return {
      id: detail.id,
      tenantId: detail.tenant_id,
      name: detail.name,
      systemPrompt: detail.system_prompt ?? '',
      model: {
        provider: 'openai',
        model: 'gpt-4o',
      },
      temperature: detail.temperature ?? 0.7,
      maxTokens: detail.max_tokens ?? 4096,
      maxSteps: detail.max_steps ?? 10,
    };
  }

  getRuntime(): AgentRuntime { return this.runtime; }
  getToolHost(): LocalToolHost { return this.toolHost; }
  getSkillManager(): SkillManager { return this.skillManager; }
  getEvents(): MittEventRecorder { return this.events; }
}

export const vicoBootstrap = new VicoBootstrap();
