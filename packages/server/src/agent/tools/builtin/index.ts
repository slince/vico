/**
 * BuiltinToolManager — 基于 Mastra Workspace 的内置工具管理器。
 *
 * 复用 Mastra 的 Workspace + LocalFilesystem + LocalSandbox 生成的工具，
 * 支持按 Agent 的 builtin_tools 配置过滤启用的工具。
 * exec 工具可选包装审批流程。
 */
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { config } from '../../../config.js';
import type { Tool } from '@mastra/core/tools';
import type { BuiltinToolsConfig } from '../../../services/agent/types.js';
import { getDb, schema } from '../../../db/db.js';

/** Mastra workspace 工具名 → 配置 key 的映射 */
const TOOL_NAME_MAP: Record<string, string> = {
  mastra_workspace_read_file: 'read',
  mastra_workspace_write_file: 'write',
  mastra_workspace_edit_file: 'edit',
  mastra_workspace_execute_command: 'exec',
  mastra_workspace_list_files: 'ls',
  mastra_workspace_grep: 'grep',
  mastra_workspace_file_stat: 'stat',
  mastra_workspace_mkdir: 'mkdir',
  mastra_workspace_delete: 'delete',
};

/**
 * 解析 Agent 的 builtin_tools JSON 配置。
 * 返回 Map<simple_name, { enabled: boolean; need_approval?: boolean }>
 */
function parseBuiltinConfig(agent: { builtin_tools: string }): Map<string, { enabled: boolean; need_approval?: boolean }> {
  try {
    const raw: BuiltinToolsConfig = JSON.parse(agent.builtin_tools || '{}');
    const map = new Map<string, { enabled: boolean; need_approval?: boolean }>();
    for (const [key, val] of Object.entries(raw)) {
      if (typeof val === 'boolean') {
        map.set(key, { enabled: val });
      } else {
        map.set(key, { enabled: val.enabled, need_approval: val.need_approval });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

class BuiltinToolManager {
  private cachedTools: Record<string, Tool> | null = null;

  /**
   * 初始化（或返回缓存的）所有 Mastra workspace 工具。
   */
  private async getAllTools(): Promise<Record<string, Tool>> {
    if (this.cachedTools) return this.cachedTools;

    try {
      const [{ Workspace, LocalFilesystem, LocalSandbox, createWorkspaceTools }] = await Promise.all([
        import('@mastra/core/workspace'),
      ]);

      const { base_path, contained, allowed_paths, timeout_ms, isolation } = config.workspace;

      const filesystem = new LocalFilesystem({
        basePath: base_path,
        contained,
        allowedPaths: allowed_paths.length > 0 ? allowed_paths : undefined,
      });

      const sandbox = new LocalSandbox({
        workingDirectory: base_path,
        timeout: timeout_ms,
        isolation: isolation as 'none' | 'seatbelt' | 'bwrap',
      });

      const workspace = new Workspace({
        filesystem,
        sandbox,
        tools: { requireApproval: false },
      });

      await workspace.init();
      this.cachedTools = await createWorkspaceTools(workspace);
      return this.cachedTools;
    } catch (err) {
      console.error('Failed to initialize builtin tools:', err);
      return {};
    }
  }

  /**
   * 获取指定 Agent 启用的内置工具。
   * 根据 Agent 的 builtin_tools 配置过滤，exec 工具根据 need_approval 决定是否包装审批。
   */
  async getToolsForAgent(
    agent: { builtin_tools: string },
    tenantId: string,
  ): Promise<Record<string, Tool>> {
    const allTools = await this.getAllTools();
    const agentConfig = parseBuiltinConfig(agent);
    const result: Record<string, Tool> = {};

    for (const [mastraName, tool] of Object.entries(allTools)) {
      const simpleName = TOOL_NAME_MAP[mastraName];
      if (!simpleName) continue;

      const entry = agentConfig.get(simpleName);
      if (!entry || !entry.enabled) continue;

      // exec 工具：如果配置了 need_approval，包装审批逻辑
      if (simpleName === 'exec' && entry.need_approval) {
        result[mastraName] = this.wrapExecWithApproval(tool, tenantId);
      } else {
        result[mastraName] = tool;
      }
    }

    return result;
  }

  /**
   * 包装 exec 工具的 execute 方法，加入审批流程。
   *
   * 审批流程：
   * 1. 写入 exec_approvals 表（status=pending）
   * 2. 轮询等待审批结果（每 500ms 查一次 DB，最长等 2 分钟）
   * 3. approved → 执行原工具逻辑；rejected → 返回拒绝消息
   */
  private wrapExecWithApproval(tool: Tool, tenantId: string): Tool {
    const originalExecute = tool.execute!.bind(tool) as (input: any, context: any) => Promise<any>;
    const wrappedTool = { ...tool };

    wrappedTool.execute = async (args: any) => {
      const command = args?.command ?? args?.params?.command ?? '';
      const db = getDb();
      const approvalId = uuid();

      // 写入审批记录
      await db.insert(schema.exec_approvals).values({
        id: approvalId,
        tenant_id: tenantId,
        agent_id: '',
        command: String(command),
        status: 'pending',
        created_at: Date.now(),
        resolved_at: null,
      }).run();

      // 轮询等待审批（最长 2 分钟）
      const startTime = Date.now();
      const maxWaitMs = 2 * 60 * 1000;
      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 500));
        const record = await db.select({ status: schema.exec_approvals.status })
          .from(schema.exec_approvals)
          .where(eq(schema.exec_approvals.id, approvalId))
          .get();

        if (!record) break;
        if (record.status === 'approved') {
          return originalExecute(args, undefined);
        }
        if (record.status === 'rejected') {
          return 'Command execution was rejected by the user.';
        }
      }

      return 'Command execution approval timed out. Please try again.';
    };

    return wrappedTool;
  }

  /** 清除缓存 */
  invalidate(): void {
    this.cachedTools = null;
  }
}

export const builtinToolManager = new BuiltinToolManager();
