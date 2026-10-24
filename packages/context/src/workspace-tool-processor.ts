// @vico/context - WorkspaceToolProcessor: filters workspace-dependent tools when session has no workspace
import type {ContextProcessor} from './context-processor.js';
import {Priority} from './context-processor.js';
import type {ModelRequestContext} from './model-request-context.js';
import type {Next} from '@vico/utils';

/** 根据 session 是否有 workspace 过滤 requires-workspace 工具 */
export class WorkspaceToolProcessor implements ContextProcessor {
  readonly name = 'workspace-tool';
  readonly priority = Priority.HIGH;

  async handle(ctx: ModelRequestContext, next: Next): Promise<void> {
    // 无 workspace 时移除依赖工作目录的工具，避免模型调用在无目录环境下失败
    if (!ctx.session?.workspace) {
      ctx.tools = ctx.tools.filter((t) => !t.tags.includes('requires-workspace'));
    }

    await next();
  }
}
