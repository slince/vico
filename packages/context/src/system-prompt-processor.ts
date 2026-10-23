// @vico/context - SystemPromptProcessor: injects agent base system prompt
import type {ContextProcessor} from './context-processor.js';
import {Priority} from './context-processor.js';
import type {ModelRequestContext} from './model-request-context.js';

/** 注入 agent 基础系统提示词，并强化用户原始目标（HIGH 优先级） */
export class SystemPromptProcessor implements ContextProcessor {
  readonly name = 'system-prompt';
  readonly priority = Priority.HIGH - 100;

  async process(ctx: ModelRequestContext): Promise<void> {
    ctx.appendSystemPrompt(ctx.agent.systemPrompt);

    const workspace = ctx.session?.workspace;
    
    if (workspace) {
      ctx.appendSystemPrompt(`你当前的工作目录是 \`${workspace}\`。所有文件操作和 shell 命令都默认在此目录下执行。`)
    }
  }
}
