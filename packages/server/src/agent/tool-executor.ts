import { skillManager } from '../skill/manager.js';
import { SkillTool, ToolContext } from '../skill/types.js';
import { getDb } from '../data/db.js';
import { v4 as uuid } from 'uuid';

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
      db.prepare(`INSERT INTO tool_call_logs (id, tenant_id, agent_id, conversation_id, message_id, tool_name, args, result, status, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        uuid(), context.tenantId, context.agentId, '', '',
        toolName, JSON.stringify(args), result ? JSON.stringify(result) : error || '',
        status, durationMs, Date.now()
      );
    } catch { /* log failure non-critical */ }
  }
}

export const toolExecutor = new ToolExecutor();
