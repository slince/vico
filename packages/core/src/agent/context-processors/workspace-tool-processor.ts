// @vico/core - WorkspaceToolProcessor: filters workspace-dependent tools when session has no workspace
import type {ContextProcessor} from './context-processor.js';
import type {ModelRequestContext} from './model-request-context.js';
import {Priority} from './context-processor.js';

/** 根据 session 是否有 workspace 过滤 requires-workspace 工具 */
export class WorkspaceToolProcessor implements ContextProcessor {
  readonly name = 'workspace-tool';
  readonly priority = Priority.HIGH;

  async process(ctx: ModelRequestContext): Promise<void> {
    if (ctx.session?.workspace) return;
    ctx.tools = ctx.tools.filter(t => !t.tags.includes('requires-workspace'));
  }
}
