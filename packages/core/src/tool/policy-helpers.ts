// @vico/core - 审批策略：support/resolve 两段式 resolver 及内置规则集
import {resolve} from 'node:path';
import type {ApprovalDecider, ApprovalMode, ApprovalResolver} from './types.js';

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
 * workspace 放行：requires-workspace 工具只要路径都在 workspace 内（或无路径）即放行；
 * 路径越界则暂停。位于 toolPolicyResolver 之后，仅承接 auto 策略的 requires-workspace 工具
 * （never/always 已由 toolPolicyResolver 先行决策）。
 */
export const workspaceResolver: ApprovalResolver = {
  order: () => ApprovalPriority.MEDIUM,
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
 * 内置审批 resolver 集，优先级由各 resolver 的 order() 决定（高 → 低）。
 */
export const defaultApprovalResolvers: ApprovalResolver[] = [
  toolPolicyResolver,
  workspaceResolver,
];

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
    // 自包含 resolver 通常单独 compose，order 仅在与其他 resolver 混用时生效，取最高优先级保证政策优先
    order: () => ApprovalPriority.HIGH,
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
          // 非工作区工具（浏览器/网络等）：auto 放行，always 需审批
          if (policy === 'always') {
            return { status: 'paused', reason: `工具 ${call.name} 需要用户审批` };
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
 * 按 order 升序（数值越小越优先）调度，首个 `support` 返回 true 的 resolver
 * 的 `resolve` 即为最终决策（首个命中即终态）；全部不参与则放行。
 */
export function composeResolvers(...resolvers: ApprovalResolver[]): ApprovalDecider {
  // 组合时按优先级升序排序一次，调用期无需重复排序
  const sorted = [...resolvers].sort((a, b) => a.order() - b.order());
  return async (call, tool, policy, ctx) => {
    for (const resolver of sorted) {
      if (!resolver.support(tool)) continue;
      return resolver.resolve(call, tool, policy, ctx);
    }
    return {status: 'approved'};
  };
}
