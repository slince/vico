// Bridge 2: Vico SkillTool[] → Mastra-compatible tools
// 将 Vico Skill 系统的工具定义和处理器适配为 Mastra Agent 可用的格式

import { z } from 'zod';
import { skillManager } from '../../../skill/manager.js';
import type { SkillTool, ToolContext } from '../../../skill/types.js';

/**
 * 将 JSON Schema 简单类型映射到 Zod schema。
 * 支持 string / number / boolean / enum / array / object。
 * 复杂嵌套类型降级为 z.any()。
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType<any> {
  const type = schema.type as string;

  switch (type) {
    case 'string': {
      let s = z.string();
      if (schema.description) s = s.describe(schema.description as string);
      return s;
    }
    case 'number':
    case 'integer': {
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
      return z.array(items);
    }
    case 'object': {
      if (!schema.properties) return z.record(z.any());
      const shape: Record<string, z.ZodType<any>> = {};
      const props = schema.properties as Record<string, Record<string, unknown>>;
      const required = (schema.required as string[]) || [];
      for (const [key, propSchema] of Object.entries(props)) {
        let field = jsonSchemaToZod(propSchema);
        if (!required.includes(key)) {
          field = field.optional();
        }
        shape[key] = field;
      }
      return z.object(shape);
    }
    default:
      return z.any();
  }
}

/**
 * 获取 Agent 绑定的所有 Skill 工具，适配为 Mastra Tool 格式。
 * 每个 Vico SkillTool 转换为 Mastra 兼容 tool 对象（含 inputSchema 和 execute）。
 */
export function getSkillToolsForMastraAgent(
  agentId: string,
  ctx: Omit<ToolContext, 'skillConfig'>,
): Record<string, {
  id: string;
  description: string;
  inputSchema: z.ZodType<any>;
  execute: (args: { context: any }) => Promise<any>;
}> {
  const skillTools = skillManager.getToolsForAgent(agentId);
  const tools: Record<string, any> = {};

  for (const st of skillTools) {
    const toolCtx: ToolContext = {
      tenantId: ctx.tenantId,
      agentId: ctx.agentId,
      userId: ctx.userId,
      skillConfig: {},
    };

    tools[st.definition.name] = {
      id: st.definition.name,
      description: st.definition.description,
      inputSchema: jsonSchemaToZod(st.definition.parameters as Record<string, unknown>),
      execute: async ({ context }: { context: any }) => {
        const args = context?.args || context || {};
        return st.handler(args, toolCtx);
      },
    };
  }

  return tools;
}

/**
 * 获取 Agent 绑定的所有 Skill 的提示词，拼接为一段文本。
 * 与原 pipeline.ts 中的拼接逻辑一致。
 */
export function getSkillPromptForAgent(agentId: string): string {
  return skillManager.getPromptForAgent(agentId);
}
