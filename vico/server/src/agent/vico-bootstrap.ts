// src/agent/vico-bootstrap.ts
import {
  Vico,
  AgentRuntime,
  type AgentConfig,
} from '@vico/agent';
import type { AgentDetail } from '../services/agent/types.js';

/**
 * Vico Bootstrap — Vico 的单例包装。
 */
export class VicoBootstrap {
  private container!: Vico;
  private runtime!: AgentRuntime;

  async init(skillRoots: string[]): Promise<void> {
    this.container = new Vico({ skills: { skillDirs: skillRoots } });
    await this.container.init();
    this.runtime = this.container.runtime;
  }

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
  getContainer(): Vico { return this.container; }
}

export const vicoBootstrap = new VicoBootstrap();
