// @vico/core - 审批策略：support/resolve 两段式 resolver 及内置规则集
import {resolve} from 'node:path';
import type {ApprovalDecider, ApprovalResolver} from './types.js';

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
 * 兜底 resolver：恒参与，按工具自身 policy（auto / on-request / never）决策。
 */
export const defaultResolver: ApprovalResolver = {
  support: () => true,
  resolve: (call, tool, policy, ctx) => {
    switch (policy) {
      case 'auto':
        return { status: 'approved' };
      case 'never':
        return { status: 'denied', reason: `工具 ${call.name} 被策略阻止` };
      case 'on-request':
        // 同一 turn 内已审批通过的工具，后续调用自动放行
        if (!ctx.firstUse && ctx.previousApproved) {
          return { status: 'approved' };
        }
        return { status: 'paused', reason: `工具 ${call.name} 首次使用需要用户审批` };
      default:
        return { status: 'denied', reason: `未知策略: ${policy}` };
    }
  }
};

/**
 * 内置审批 resolver 集，数组顺序即优先级（高 → 低）。
 */
export const defaultApprovalResolvers: ApprovalResolver[] = [
  neverDenyResolver,
  workspaceResolver,
  defaultResolver,
];

/**
 * 审批政策模式 — 用户在 composer 选择、随请求下发的全局审批策略。
 *
 * - `approve-all`：全部审批，任何工具调用都需要用户审批
 * - `readonly`：只读模式，只读工具自动通过，修改/更新/删除需审批
 * - `workspace`：工作区内修改，workspace 内完全权限，越界需审批
 * - `full-access`：完全权限，不做任何审批直接通过
 */
export type ApprovalMode = 'approve-all' | 'readonly' | 'workspace' | 'full-access';

/**
 * 依据审批政策模式构建自包含 resolver（support 恒真、resolve 覆盖全部决策）。
 *
 * 该 resolver 会作为 run 级审批判定的唯一来源（替换默认 resolver 链），
 * 因此需自行处理三类前置规则：
 * - `policy: 'never'` 在所有模式下保持硬阻断（denied）；
 * - `human-in-the-loop` 澄清工具（ask_user）需要用户输入，任何模式都不自动放行（paused）。
 *
 * @param mode - 审批政策模式
 * @returns 自包含的 ApprovalResolver，可直接 compose 为 ApprovalDecider
 */
export function createApprovalModeResolver(mode: ApprovalMode): ApprovalResolver {
  return {
    support: () => true,
    resolve: (call, tool, policy, ctx) => {
      // never 硬阻断：无论何种模式，被策略标记为 never 的工具一律拒绝
      if (policy === 'never') {
        return { status: 'denied', reason: `工具 ${call.name} 被策略阻止` };
      }
      // 澄清类工具（ask_user）依赖审批 reason 读取用户回答，放行会直接报错，始终暂停
      if (tool.tags.includes('human-in-the-loop')) {
        return { status: 'paused', reason: `工具 ${call.name} 需要用户输入` };
      }

      switch (mode) {
        case 'approve-all':
          return { status: 'paused', reason: `工具 ${call.name} 需要用户审批` };

        case 'readonly':
          return tool.kind === 'readonly'
            ? { status: 'approved' }
            : { status: 'paused', reason: `工具 ${call.name} 会修改状态，需要审批` };

        case 'workspace': {
          // 工作区文件工具：路径全在工作区内（或无路径，如 bash）放行，越界暂停
          if (tool.tags.includes('requires-workspace')) {
            const args = (ctx.toolArgs ?? call.args) as Record<string, unknown> | undefined;
            const paths = extractPaths(args);
            if (paths.length === 0) return { status: 'approved' };
            const allInWorkspace = paths.every((p) => isPathInWorkspace(p, ctx.workspace));
            if (allInWorkspace) return { status: 'approved' };
            return { status: 'paused', reason: `工具 ${call.name} 尝试访问 workspace 外路径` };
          }
          // 非工作区工具（浏览器/网络等）：auto 放行，on-request 首次需审批
          if (policy === 'on-request') {
            if (!ctx.firstUse && ctx.previousApproved) return { status: 'approved' };
            return { status: 'paused', reason: `工具 ${call.name} 首次使用需要用户审批` };
          }
          return { status: 'approved' };
        }

        case 'full-access':
          return { status: 'approved' };

        default:
          return { status: 'denied', reason: `未知审批模式: ${mode}` };
      }
    },
  };
}

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
