// @vico/agent - DynamicInstructionProcessor: appends dynamic instructions as system message
import type { ContextProcessor, ModelRequestContext } from '../prompt/context-processor.js';
import { Priority } from '../prompt/context-processor.js';

/** 追加动态指令为 system 消息（LOW 优先级） */
export class DynamicInstructionProcessor implements ContextProcessor {
  readonly name = 'dynamic-instructions';
  readonly priority = Priority.LOW;

  constructor(private readonly getInstructions: () => string[]) {}

  async process(ctx: ModelRequestContext): Promise<void> {
    const instructions = this.getInstructions();
    if (instructions.length === 0) return;

    ctx.messages.push({ role: 'system', content: instructions.join('\n') });
  }
}
