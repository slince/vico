// @vico/core - 审批策略：support/resolve 两段式 resolver 及内置规则集
import {resolve} from 'node:path';
import type {ApprovalDecider, ApprovalResolver, ToolKind} from './types.js';
import {resolvePolicy} from './utils.js';

/** 路径参数常用名称 */
const PATH_ARG_NAMES = new Set(['path', 'filePath', 'file', 'target', 'directory', 'dir']);

/** 破坏性工具类别：默认需要审批 */
const DESTRUCTIVE_KINDS = new Set<ToolKind>(['mutation', 'file_change', 'command']);

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
 * never 拒绝：`policy: 'never'` 的工具一律拒绝，优先级最高、不可被覆盖。
 */
export const neverDenyResolver: ApprovalResolver = {
  support: tool => tool.policy === 'never',
  resolve: call => ({status: 'denied', reason: `工具 ${call.name} 被策略阻止`}),
};

/**
 * workspace 放行：requires-workspace 工具只要路径都在 workspace 内（或无路径）即放行；
 * 路径越界则暂停。排在 destructive 之前，从而覆盖破坏性工具的默认暂停。
 */
export const workspaceResolver: ApprovalResolver = {
  support: tool => tool.tags.includes('requires-workspace'),
  resolve: (call, _tool, _policy, ctx) => {
    const workspace = ctx.workspace;
    // WorkspaceToolProcessor 已保证 requires-workspace 工具必有 workspace，此处防御
    if (!workspace) {
      return {status: 'paused', reason: `工具 ${call.name} 需要 workspace 但未配置`};
    }
    const args = (ctx.toolArgs ?? call.args) as Record<string, unknown> | undefined;
    const paths = extractPaths(args);
    // 无路径参数的工具（如 bash、git-commit）视为在 workspace 内执行
    if (paths.length === 0) return {status: 'approved'};
    const allInWorkspace = paths.every(p => isPathInWorkspace(p, workspace));
    if (allInWorkspace) return {status: 'approved'};
    return {status: 'paused', reason: `工具 ${call.name} 尝试访问 workspace 外路径`};
  },
};

/**
 * 破坏性工具暂停：mutation / file_change / command 类工具默认需要审批。
 */
export const destructiveResolver: ApprovalResolver = {
  support: tool => DESTRUCTIVE_KINDS.has(tool.kind),
  resolve: call => ({status: 'paused', reason: `工具 ${call.name} 为破坏性操作，需要审批`}),
};

/**
 * 兜底 resolver：恒参与，按工具自身 policy（auto / on-request / never）决策。
 */
export const defaultResolver: ApprovalResolver = {
  support: () => true,
  resolve: (call, tool, policy, ctx) => resolvePolicy(call, tool, policy, ctx),
};

/**
 * 内置审批 resolver 集，数组顺序即优先级（高 → 低）。
 */
export const defaultApprovalResolvers: ApprovalResolver[] = [
  neverDenyResolver,
  workspaceResolver,
  destructiveResolver,
  defaultResolver,
];

/**
 * 组合多个 ApprovalResolver 为判定函数。
 *
 * 按数组顺序遍历，首个 `support` 返回 true 的 resolver 的 `resolve` 即为最终决策；
 * 全部不参与则放行。
 */
export function composeResolvers(...resolvers: ApprovalResolver[]): ApprovalDecider {
  return async (call, tool, policy, ctx) => {
    for (const resolver of resolvers) {
      if (!resolver.support(tool)) continue;
      const decision = await resolver.resolve(call, tool, policy, ctx);
      if (decision.status !== 'approved') return decision;
    }
    return {status: 'approved'};
  };
}
