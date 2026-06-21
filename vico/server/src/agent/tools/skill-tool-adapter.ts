/**
 * Vico Skill Tool 适配器
 *
 * 将 Vico Skill 的 JSON Schema 参数定义转换为 Vico Tool 接口格式。
 * 不再依赖 Mastra createTool()。
 */
import { skillManager } from '../../skill/manager.js';
import type { SkillToolDef, ToolContext } from '../../skill/types.js';
import { config } from '../../config.js';
import type { Tool } from '@vico/agent';

/**
 * 将单个 SkillToolDef 转换为 Vico Tool。
 */
async function adaptTool(def: SkillToolDef, context: ToolContext): Promise<Tool> {
  const tools = await skillManager.getToolsForAgent(context.agentId);
  const tool = tools.find((t) => t.definition.name === def.name);
  if (!tool) throw new Error(`Tool ${def.name} handler not found`);

  const safeContext: ToolContext = { ...context, skillConfig: context.skillConfig || {} };

  return {
    name: def.name,
    description: def.description,
    inputSchema: (def.parameters || {}) as Record<string, unknown>,
    policy: 'auto',
    kind: 'readonly',
    tags: ['skill'],
    execute: async (call, ctx) => {
      const timeoutMs = config.tool.timeout_ms;
      return Promise.race([
        tool.handler(call.args, safeContext),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool "${def.name}" timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
    },
  };
}

/**
 * 获取 Agent 绑定的所有 Skill 工具，转换为 Vico Tool 格式。
 */
export async function getSkillTools(agentId: string, context: ToolContext): Promise<Tool[]> {
  const defs = await skillManager.getToolDefsForAgent(agentId);
  const tools: Tool[] = [];
  for (const def of defs) {
    tools.push(await adaptTool(def, context));
  }
  return tools;
}
