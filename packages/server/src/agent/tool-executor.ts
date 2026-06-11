import { v4 as uuid } from 'uuid';
import { skillManager } from '../skill/manager.js';
import { SkillTool, ToolContext } from '../skill/types.js';
import { getDb, schema } from '../data/db.js';

const { tool_call_logs } = schema;

interface ToolExecResult {
  success: boolean;
  result?: any;
  error?: string;
}

export class ToolExecutor {
  private toolCache: Map<string, SkillTool[]> = new Map();

  private buildToolMap(agentId: string): Map<string, SkillTool> {
    const tools = skillManager.getToolsForAgent(agentId);
    this.toolCache.set(agentId, tools);
    const map = new Map<string, SkillTool>();
    for (const t of tools) {
      map.set(t.definition.name, t);
    }
    return map;
  }

  async execute(
    toolName: string,
    args: any,
    context: ToolContext
  ): Promise<ToolExecResult> {
    const toolMap = this.buildToolMap(context.agentId);
    const tool = toolMap.get(toolName);

    const startTime = Date.now();
    let status = 'success';
    let result: any = null;
    let error: string | undefined;

    if (!tool) {
      status = 'error';
      error = `Tool not found: ${toolName}`;
    } else {
      try {
        const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
        result = await tool.handler(parsedArgs, context);
      } catch (err: any) {
        status = 'error';
        error = err.message;
      }
    }

    this.logToolCall(toolName, args, result, error, status, Date.now() - startTime, context);
    return { success: status === 'success', result, error };
  }

  private logToolCall(
    toolName: string,
    args: any,
    result: any,
    error: string | undefined,
    status: string,
    durationMs: number,
    context: ToolContext
  ) {
    try {
      const db = getDb();
      db.insert(tool_call_logs).values({
        id: uuid(), tenant_id: context.tenantId, agent_id: context.agentId,
        conversation_id: '', message_id: '', tool_name: toolName,
        args: JSON.stringify(args), result: result ? JSON.stringify(result) : error || '',
        status, duration_ms: durationMs, created_at: Date.now(),
      }).run();
    } catch { /* log failure non-critical */ }
  }
}

export const toolExecutor = new ToolExecutor();
