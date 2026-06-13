/**
 * Vico SkillTool -> Mastra Tool 适配器
 * 将 Vico Skill 的 JSON Schema 参数定义转换为 Mastra createTool() 格式，
 * 保留与现有 Skill 插件系统的完全兼容。
 */
import { createTool } from '@mastra/core/tools';
import { z, type ZodTypeAny } from 'zod';
import { skillManager } from '../../skill/manager.js';
import type { SkillToolDef, ToolContext } from '../../skill/types.js';
import { config } from '../../config.js';

/**
 * 将 JSON Schema 参数对象递归转换为 Zod schema。
 *
 * 支持的 JSON Schema 类型：
 * - string, number, integer, boolean
 * - array（嵌套 items schema）
 * - object（嵌套 properties + required）
 * - 字段级 description 映射为 Zod .describe()
 * - required 数组控制 .optional() 行为
 *
 * @param schema - JSON Schema 对象（如 { type: 'object', properties: {...} }）
 * @returns 对应的 ZodTypeAny 实例
 */
function jsonSchemaToZod(schema: Record<string, unknown>): ZodTypeAny {
  const type = schema.type as string;
  switch (type) {
    case 'string': {
      let s = z.string();
      if (schema.description) s = s.describe(schema.description as string);
      return s;
    }
    case 'integer': {
      let n = z.number().int();
      if (schema.description) n = n.describe(schema.description as string);
      return n;
    }
    case 'number': {
      let n = z.number();
      if (schema.description) n = n.describe(schema.description as string);
      return n;
    }
    case 'boolean': {
      let b = z.boolean();
      if (schema.description) b = b.describe(schema.description as string);
      return b;
    }
    case 'array': {
      const items = schema.items
        ? jsonSchemaToZod(schema.items as Record<string, unknown>)
        : z.any();
      let arr = z.array(items);
      if (schema.description) arr = arr.describe(schema.description as string);
      return arr;
    }
    case 'object': {
      if (!schema.properties) {
        // 无 properties 的对象视为自由格式 record
        return z.record(z.string(), z.any());
      }
      const shape: Record<string, ZodTypeAny> = {};
      const props = schema.properties as Record<string, Record<string, unknown>>;
      const required = (schema.required as string[]) || [];
      for (const [key, propSchema] of Object.entries(props)) {
        let field = jsonSchemaToZod(propSchema);
        // non-required fields become optional
        if (!required.includes(key)) field = field.optional();
        shape[key] = field;
      }
      return z.object(shape);
    }
    default:
      return z.any();
  }
}

/**
 * 将单个 SkillToolDef 转换为 Mastra Tool。
 *
 * - 使用 createTool() 创建 Mastra 原生 Tool 实例
 * - JSON Schema parameters -> Zod inputSchema
 * - execute 中查找 Skill 的 handler 实现并调用，带超时保护
 *
 * @param def - Skill 工具定义（name, description, JSON Schema parameters）
 * @param context - Vico ToolContext 传递给 handler 的运行时上下文
 * @returns Mastra Tool 实例
 */
async function adaptTool(def: SkillToolDef, context: ToolContext) {
  // SkillToolDef.parameters 始终为 object 类型 JSON Schema
  const zodSchema = jsonSchemaToZod(def.parameters as Record<string, unknown>);

  // Resolve handler once at construction time, not on every invocation
  const tools = await skillManager.getToolsForAgent(context.agentId);
  const tool = tools.find((t) => t.definition.name === def.name);
  if (!tool) throw new Error(`Tool ${def.name} handler not found`);

  // Ensure skillConfig defaults to {} so downstream handlers don't break
  const safeContext: ToolContext = { ...context, skillConfig: context.skillConfig || {} };

  return createTool({
    id: def.name,
    description: def.description,
    // Mastra execute 签名: (inputData, toolExecutionContext)
    // inputData 已是经 inputSchema 校验后的参数对象
    execute: async (args) => {
      // 将校验后的参数转发给 Vico Skill handler，带超时保护
      const timeoutMs = config.tool.timeout_ms;
      return Promise.race([
        tool.handler(args, safeContext),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool "${def.name}" timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
    },
    inputSchema: zodSchema,
  });
}

/**
 * 获取 Agent 绑定的所有 Skill 工具，转换为 Mastra Tool 格式。
 *
 * 返回 Record<string, Tool> 可直接传入 Mastra Agent 的 tools 配置。
 *
 * @param agentId - Agent ID
 * @param context - Vico ToolContext 运行时上下文
 * @returns 以工具名为 key 的 Mastra Tool 映射
 */
export async function getSkillToolsForMastraAgent(
  agentId: string,
  context: ToolContext,
): Promise<Record<string, ReturnType<typeof createTool>>> {
  const defs = await skillManager.getToolDefsForAgent(agentId);
  const tools: Record<string, ReturnType<typeof createTool>> = {};
  for (const def of defs) {
    tools[def.name] = await adaptTool(def, context);
  }
  return tools;
}
