// @vico/core - Policy helper functions for composing custom ApprovalResolver logic
import {resolve} from 'node:path';
import type {ApprovalDecision, ApprovalResolver, PolicyContext, Tool, ToolCall, ToolPolicy} from './types.js';

/** 路径参数常用名称 */
const PATH_ARG_NAMES = new Set(['path', 'filePath', 'file', 'target', 'directory', 'dir']);

/**
 * 检查给定路径是否在 workspace 目录内。
 */
export function isPathInWorkspace(targetPath: string, workspace?: string): boolean {
  if (!workspace) return false;
  try {
    const abs = targetPath.startsWith('/') ? targetPath : resolve(workspace, targetPath);
    return abs.startsWith(workspace.endsWith('/') ? workspace : workspace + '/') || abs === workspace;
  } catch {
    return false;
  }
}

/**
 * 从 toolArgs 中提取所有路径值。
 */
function extractPaths(toolArgs: Record<string, unknown> | undefined): string[] {
  if (!toolArgs) return [];
  return Object.entries(toolArgs)
    .filter(([key, value]) => PATH_ARG_NAMES.has(key) && typeof value === 'string')
    .map(([, value]) => value as string);
}

/**
 * workspace 绑定策略：所有路径参数在 workspace 内则自动放行，否则需要审批（on-request 行为）。
 *
 * 通过工具的 policy 字段判断是否还有更严格的限制（如 never），不覆盖更强限制。
 */
export function workspaceBoundPolicy<TInput = unknown, TOutput = unknown>(
  call: ToolCall<TInput>,
  tool: Tool<TInput, TOutput>,
  _policy: ToolPolicy,
  ctx: PolicyContext<TInput>,
): ApprovalDecision {
  // 不处理非 requires-workspace 工具
  if (!tool.tags.includes('requires-workspace')) return { status: 'approved' };

  const workspace = ctx.workspace;
  if (!workspace) return { status: 'approved' };

  const args = (ctx.toolArgs ?? call.args) as Record<string, unknown> | undefined;
  const paths = extractPaths(args);

  // 无路径参数的工具（如 bash）直接放行
  if (paths.length === 0) return { status: 'approved' };

  // 所有路径参数都在 workspace 内 → 自动放行
  const allInWorkspace = paths.every(p => isPathInWorkspace(p, workspace));
  if (allInWorkspace) return { status: 'approved' };

  // 有路径在 workspace 外 → 需要审批
  return { status: 'paused', reason: `工具 ${call.name} 尝试访问 workspace 外路径` };
}

/**
 * 破坏性工具策略：mutation/file_change 类工具默认需要审批（首次暂停）。
 */
export function destructiveToolPolicy<TInput = unknown, TOutput = unknown>(
  call: ToolCall<TInput>,
  tool: Tool<TInput, TOutput>,
  _policy: ToolPolicy,
  _ctx: PolicyContext<TInput>,
): ApprovalDecision {
  const destructiveKinds = new Set(['mutation', 'file_change', 'command']);
  if (destructiveKinds.has(tool.kind)) {
    return { status: 'paused', reason: `工具 ${call.name} 为破坏性操作，需要审批` };
  }
  return { status: 'approved' };
}

/**
 * 组合多个 ApprovalResolver 为链式决策器。
 *
 * 按顺序调用每个 resolver，首个返回 non-approved 结果（denied/paused）的作为最终决策；
 * 全部返回 approved 则放行。
 */
export function composeResolvers(
  ...resolvers: ApprovalResolver[]
): ApprovalResolver {
  return async (call, tool, policy, ctx) => {
    for (const resolver of resolvers) {
      const decision = await resolver(call, tool, policy, ctx);
      if (decision.status !== 'approved') return decision;
    }
    return { status: 'approved' };
  };
}
