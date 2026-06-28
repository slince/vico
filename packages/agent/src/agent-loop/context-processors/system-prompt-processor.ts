// @vico/agent - SystemPromptProcessor: injects agent base system prompt
import type {ContextProcessor, ModelRequestContext} from './context-processor.js';
import {Priority} from './context-processor.js';

/** 注入 agent 基础系统提示词（HIGH 优先级） */
export class SystemPromptProcessor implements ContextProcessor {
  readonly name = 'system-prompt';
  readonly priority = Priority.HIGH - 100;

  async process(ctx: ModelRequestContext): Promise<void> {
    ctx.systemPrompt = ctx.agent.systemPrompt;
  }
}
