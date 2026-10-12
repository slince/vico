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
 * 审批 resolver 优先级档位 — order 越小越优先，用户可自定义任意整数。
 */
export const ApprovalPriority = {
  /** 高优先级（最先调度） */
  HIGH: -100,
  /** 普通优先级 */
  MEDIUM: 0,
  /** 低优先级（最后调度） */
  LOW: 100,
} as const;

/**
 * tool.policy 通用 resolver：只处理 `never` 与 `always`，`auto` 交予其它 resolver。
 *
 * - `never`：硬拒绝，优先级最高、不可被覆盖；
 * - `always`：必审批。
 */
export const toolPolicyResolver: ApprovalResolver = {
  order: () => ApprovalPriority.HIGH,
  support: tool => tool.policy === 'never' || tool.policy === 'always',
  resolve: (call, _tool, policy) => {
    // never 硬拒绝，不可被 workspace 等后续 resolver 覆盖
    if (policy === 'never') {
      return { status: 'denied', reason: `工具 ${call.name} 被策略阻止` };
    }
    // always 必审批
    return { status: 'paused', reason: `工具 ${call.name} 需要用户审批` };
  },
};

/**
 * 审批政策模式通用 resolver：读取 PolicyContext.approvalMode 决策 auto 工具。
 *
 * never/always 已由 toolPolicyResolver（更高优先级）先行决策，本 resolver 仅承接 auto 工具；
 * 未指定 approvalMode 时不参与（support 返回 false），交由 workspaceResolver 走默认 workspace 边界。
 */
export const approvalModeResolver: ApprovalResolver = {
  order: () => ApprovalPriority.MEDIUM,

  support: (_tool, ctx) => true,

  resolve: (call, tool, _policy, ctx) => {
    const approvalMode = ctx.approvalMode ?? 'workspace';

    switch (approvalMode) {
      case 'approve-all':
        // 全部工具都需用户审批
        return {
          status: 'paused',
          reason: `工具 ${call.name} 需要用户审批`,
        };

      case 'readonly':
        // 只读工具放行，变更工具需审批
        if (tool.kind === 'readonly') {
          return { status: 'approved' };
        }
        return {
          status: 'paused',
          reason: `工具 ${call.name} 会修改状态，需要审批`,
        };

      case 'workspace': {
        // 工作区文件工具：路径全在工作区内（或无路径，如 bash）放行，越界暂停
        if (tool.tags.includes('requires-workspace')) {
          const args = (ctx.toolArgs ?? call.args) as Record<string, unknown> | undefined;
          const paths = extractPaths(args);

          if (paths.length === 0) {
            return { status: 'approved' };
          }

          const allInWorkspace = paths.every((p) => isPathInWorkspace(p, ctx.workspace));
          if (allInWorkspace) {
            return { status: 'approved' };
          }

          return {
            status: 'paused',
            reason: `工具 ${call.name} 尝试访问 workspace 外路径`,
          };
        }

        // 非工作区工具（浏览器/网络等）：放行
        return { status: 'approved' };
      }

      case 'full-access':
        // 完全权限：直接放行
        return { status: 'approved' };

      default:
        // 兜底放行
        return { status: 'approved' };
    }
  },
};

/**
 * 内置审批 resolver 集，优先级由各 resolver 的 order() 决定（高 → 低）。
 */
export const defaultApprovalResolvers: ApprovalResolver[] = [
  toolPolicyResolver,
  approvalModeResolver,
];

/**
 * 组合多个 ApprovalResolver 为判定函数。
 *
 * 按 order 升序（数值越小越优先）调度，首个 `support` 返回 true 的 resolver
 * 的 `resolve` 即为最终决策（首个命中即终态）；全部不参与则放行。
 */
export function composeResolvers(...resolvers: ApprovalResolver[]): ApprovalDecider {
  // 组合时按优先级升序排序一次，调用期无需重复排序
  const sorted = [...resolvers].sort((a, b) => a.order() - b.order());
  return async (call, tool, policy, ctx) => {
    for (const resolver of sorted) {
      if (!resolver.support(tool, ctx)) continue;
      return resolver.resolve(call, tool, policy, ctx);
    }
    return {status: 'approved'};
  };
}
