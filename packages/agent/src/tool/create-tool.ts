// @vico/agent - createTool: factory for building Tool objects with Zod validation
import {z} from 'zod';
import type {Tool, ToolExecutionContext, ToolKind, ToolPolicy} from './types.js';
import type {ToolDescriptor} from '../model/types.js';

/** createTool 的配置选项 */
export interface ToolOptions<TInput = any, TOutput = any> {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** Zod 参数 schema，用于校验 call.args 和生成 JSON Schema */
  inputSchema: z.ZodType<TInput, any>;
  /** Zod 输出 schema（可选），用于输出校验 */
  outputSchema?: z.ZodType<TOutput, any>;
  /** 审批策略，默认 'auto' */
  policy?: ToolPolicy;
  /** 工具类别，默认 'command' */
  kind?: ToolKind;
  /** 来源标签 */
  tags?: string[];
  /** 执行逻辑，args 已通过 inputSchema 校验并推导类型，返回值受 outputSchema 约束 */
  execute: (args: TInput, ctx: ToolExecutionContext) => Promise<TOutput>;
}

/**
 * 创建一个 Tool 对象。
 *
 * 使用 Zod schema 定义参数，自动在 execute 前校验 call.args，
 * 并可通过 toToolDescriptor() 将 Zod schema 转为 JSON Schema 供模型调用。
 *
 * @example
 * ```ts
 * const echo = createTool({
 *   name: 'echo',
 *   description: 'Echo back the input',
 *   inputSchema: z.object({ message: z.string() }),
 *   execute: async (args) => args.message,
 * });
 * ```
 */
export function createTool<TInput = any, TOutput = any>(options: ToolOptions<TInput, TOutput>): Tool<TInput, TOutput> {
  const rawExecute = options.execute;

  return {
    name: options.name,
    description: options.description,
    inputSchema: options.inputSchema,
    outputSchema: options.outputSchema,
    policy: options.policy ?? 'auto',
    kind: options.kind ?? 'command',
    tags: options.tags ?? [],
    async execute(call, ctx) {
      const args = options.inputSchema.parse(call.args);
      const result = await rawExecute(args, ctx);
      if (options.outputSchema) {
        options.outputSchema.parse(result);
      }
      return result;
    },
  };
}

/**
 * 将 Tool 的 Zod inputSchema 转为 ToolDescriptor（含 JSON Schema）供模型调用。
 *
 * @param tool - 工具对象，包含 name、description 和 Zod inputSchema
 * @returns ToolDescriptor 对象，包含 JSON Schema 格式的 inputSchema
 */
export function toToolDescriptor(tool: Tool): ToolDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>,
  };
}
