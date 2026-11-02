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
    ctx.systemPrompt.registerSection('system', ctx.agent.systemPrompt);

    const workspace = ctx.session?.workspace;

    if (workspace) {
      ctx.systemPrompt.registerSection(
        'workspace',
        [
          `Your current working directory is \`${workspace}\`. All file operations and shell commands run in this directory by default.`,
          // 文件引用规范：仅对「本回复实际 read/write/edit 过的文件」用相对路径 + 反引号标记；
          // 前端据此把命中的路径渲染成可点击链接，未实际操作过的文件名不会被识别为链接。
          `When you mention a file in your reply, reference it by its path relative to the working directory, wrapped in single backticks (e.g. \`src/index.ts\`), and only for files you actually read, wrote, or edited this turn. Do not prepend the full absolute path.`,
        ].join(' '),
      );
    }

    await next();
  }
}
