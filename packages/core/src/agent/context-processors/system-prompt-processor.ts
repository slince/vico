// @vico/core - SystemPromptProcessor: injects agent base system prompt
import type {ContextProcessor} from './context-processor.js';
import type {ModelRequestContext} from './model-request-context.js';
import {Priority} from './context-processor.js';

/** 注入 agent 基础系统提示词，并强化用户原始目标（HIGH 优先级） */
export class SystemPromptProcessor implements ContextProcessor {
  readonly name = 'system-prompt';
  readonly priority = Priority.HIGH - 100;

  async process(ctx: ModelRequestContext): Promise<void> {
    const goal = ctx?.userMessage?.content;
    const goalBlock = goal
      ? `\n\n<primary_goal>\n你的首要任务是完成以下用户请求。在整个对话过程中始终牢记此目标，不要因为中间工具执行结果而偏离方向。如果发现自己开始偏离，请立即重新聚焦到此目标。\n\n用户目标：${goal}\n</primary_goal>`
      : '';

    ctx.systemPrompt = ctx.agent.systemPrompt + goalBlock;
  }
}
