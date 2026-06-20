// src/agent/vico-bootstrap.ts
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import {
  Vico,
  AISDKModelClient,
  AgentRuntime,
  type ModelClientFactory,
  type AgentConfig,
} from '@vico/agent';
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
 * Vico Bootstrap — Vico 的单例包装。
 * 管理 AgentRuntime + ToolHost + SkillManager 生命周期。
 */
export class VicoBootstrap {
  private container!: Vico;
  private runtime!: AgentRuntime;

  async init(skillRoots: string[]): Promise<void> {
    this.container = new Vico({ skillRoots });
    await this.container.init();

    const modelFactory: ModelClientFactory = (config) => {
      const languageModel = createLanguageModel(config.model);
      return new AISDKModelClient(languageModel, config.model.provider, config.model.model);
    };

    this.runtime = this.container.getRuntime(modelFactory);
  }

  /** 根据 DB AgentDetail 创建 Vico AgentConfig */
  static toAgentConfig(detail: AgentDetail): AgentConfig {
    return {
      id: detail.id,
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
  getToolHost() { return this.container.toolHost; }
  getSkillManager() { return this.container.getSkillManager(); }
  getEvents() { return this.container.events; }
}

export const vicoBootstrap = new VicoBootstrap();
