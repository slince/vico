// @vico/agent - createTool: factory for building Tool objects with sensible defaults
import type {Tool, ToolCall, ToolExecutionContext, ToolKind, ToolPolicy} from './types.js';

/** createTool 的配置选项 */
export interface ToolOptions {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** JSON Schema 格式的输入约束 */
  inputSchema?: Record<string, unknown>;
  /** 审批策略，默认 'auto' */
  policy?: ToolPolicy;
  /** 工具类别，默认 'command' */
  kind?: ToolKind;
  /** 来源标签 */
  tags?: string[];
  /** 执行逻辑 */
  execute: (call: ToolCall, ctx: ToolExecutionContext) => Promise<unknown>;
}

/**
 * 创建一个 Tool 对象。
 *
 * 提供合理的默认值（policy='auto', kind='command', tags=[]），
 * 简化工具定义，减少样板代码。
 *
 * @example
 * ```ts
 * const echo = createTool({
 *   name: 'echo',
 *   description: 'Echo back the input',
 *   inputSchema: {
 *     type: 'object',
 *     properties: { message: { type: 'string' } },
 *     required: ['message'],
 *   },
 *   execute: async (call) => call.args.message,
 * });
 * ```
 */
export function createTool(options: ToolOptions): Tool {
  const tool: Tool = {
    name: options.name,
    description: options.description,
    inputSchema: options.inputSchema ?? { type: 'object', properties: {} },
    policy: options.policy ?? 'auto',
    kind: options.kind ?? 'command',
    tags: options.tags ?? [],
    execute: options.execute,
  };

  return tool;
}
