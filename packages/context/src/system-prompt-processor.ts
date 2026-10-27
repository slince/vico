// @vico/context - SystemPromptProcessor: injects agent base system prompt
import type {ContextProcessor} from './context-processor.js';
import {Priority} from './context-processor.js';
import type {ModelRequestContext} from './model-request-context.js';
import type {Next} from '@vico/utils';

/** 注入 agent 基础系统提示词，并强化用户原始目标（HIGH 优先级） */
export class SystemPromptProcessor implements ContextProcessor {
  readonly name = 'system-prompt';
  readonly priority = Priority.HIGH - 100;

  async handle(ctx: ModelRequestContext, next: Next): Promise<void> {
    ctx.appendSystemPrompt(ctx.agent.systemPrompt);

    const workspace = ctx.session?.workspace;

    if (workspace) {
      ctx.appendSystemPrompt(`Your current working directory is \`${workspace}\`. All file operations and shell commands run in this directory by default.`);
    }

    await next();
  }
}
