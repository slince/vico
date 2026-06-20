// src/agent/vico-bootstrap.ts
import {
  Vico,
  AgentRuntime,
  type AgentConfig,
} from '@vico/agent';
import type { AgentDetail } from '../services/agent/types.js';

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
    this.runtime = this.container.runtime;
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
