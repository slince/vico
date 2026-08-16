# 审批策略机制升级：support/resolve 两段式 resolver

> 状态：待评审
> 日期：2026-08-17

## 1. 背景与问题

当前工具审批采用「resolver 链式组合」，`composeResolvers` 语义是**「首个非 approved 决策即最终决策」**（deny-first，全票通过制）。组合顺序在 `create-agent.ts` 中为：

```ts
const approvalResolvers = [destructiveToolPolicy, workspaceBoundPolicy, resolvePolicy];
approvalResolver: composeResolvers(...approvalResolvers)
```

问题：该模型无法表达「放行覆盖暂停」。`destructiveToolPolicy` 排第一，凡 `kind ∈ {mutation, file_change, command}` 一律 `paused`；后续 `workspaceBoundPolicy` 即使判断「路径都在 workspace 内」返回 `approved`，也没机会覆盖前面的 `paused`。

需求：**所有 `requires-workspace` 工具，只要操作路径在 workspace 内就免审**，包括 `file_change`（write/edit/file_create）这类破坏性工具，以及 `mutation`（git-commit）、`command`（bash/package）。

## 2. 目标

把 `ApprovalResolver` 从「单函数 + 一票否决组合」升级为「support/resolve 两段式对象 + 首个命中即终态组合」，核心是让**参与判断的范围显式化**，并让**数组顺序取代隐式优先级**：

1. 每个 resolver 用 `support(tool)` 声明自己管哪些工具，不相关的直接跳过；
2. 组合时**第一个 `support` 命中的 resolver 的 `resolve` 即终态**，因此靠顺序即可让高优先级的「workspace 放行」压过低优先级的「破坏性暂停」；
3. `never` 策略的拒绝由排最前的 `neverDenyResolver` 保证，不可被覆盖。

## 3. 安全不变量

```
denied（never） > approved（workspace 放行） > paused（破坏性/on-request/越界） > approved（auto 默认）
```

- `policy: 'never'` 永远拒绝，workspace 免审不能覆盖它（由 `neverDenyResolver` 排最前保证）。
- workspace 放行必须覆盖 destructive 的 `paused` 和 `on-request` 的首次暂停（由 `workspaceResolver` 排在 `destructiveResolver` 之前保证）。

## 4. 核心模型（`packages/core/src/tool/types.ts`）

`ApprovalStatus`、`ApprovalDecision`、`PolicyContext`、`ToolPolicy` 保持不变。

`ApprovalResolver` 由函数改为对象，新增 `ApprovalDecider` 表示组合后的判定函数：

```ts
/** 审批 resolver：support 声明参与范围，resolve 给出决策 */
export interface ApprovalResolver<TInput = unknown, TOutput = unknown> {
  /** 是否参与该工具的审批判断；返回 false 则跳过该 resolver */
  support(tool: Tool<TInput, TOutput>): boolean;
  /** 决策逻辑，仅当 support 返回 true 时被调用 */
  resolve(
    call: ToolCall<TInput>,
    tool: Tool<TInput, TOutput>,
    policy: ToolPolicy,
    context: PolicyContext<TInput>,
  ): ApprovalDecision | Promise<ApprovalDecision>;
}

/** 组合后的判定函数，供引擎直接调用 */
export type ApprovalDecider<TInput = unknown, TOutput = unknown> = (
  call: ToolCall<TInput>,
  tool: Tool<TInput, TOutput>,
  policy: ToolPolicy,
  context: PolicyContext<TInput>,
) => ApprovalDecision | Promise<ApprovalDecision>;
```

## 5. 组合引擎（`policy-helpers.ts`）

`composeResolvers` 语义从「首个非 approved 即终止」改为「首个 support 命中即终态」：

```ts
export function composeResolvers(...resolvers: ApprovalResolver[]): ApprovalDecider {
  return async (call, tool, policy, ctx) => {
    for (const r of resolvers) {
      if (!r.support(tool)) continue;      // 不参与则跳过
      return r.resolve(call, tool, policy, ctx); // 第一个参与的 resolver 说了算
    }
    return { status: 'approved' };          // 兜底；实际 defaultResolver 恒命中
  };
}
```

## 6. 内置 resolver 集（`policy-helpers.ts`）

数组顺序即优先级：

| 顺序 | resolver | support(tool) | resolve |
|------|----------|--------------|---------|
| 1 | `neverDenyResolver` | `tool.policy === 'never'` | `denied` |
| 2 | `workspaceResolver` | `tool.tags.includes('requires-workspace')` | 无路径或路径全在 ws → `approved`；越界 → `paused` |
| 3 | `destructiveResolver` | `kind ∈ {mutation, file_change, command}` | `paused` |
| 4 | `defaultResolver` | 恒 `true` | `resolvePolicy(...)` |

导出 `defaultApprovalResolvers = [neverDenyResolver, workspaceResolver, destructiveResolver, defaultResolver]`。

迁移映射：

- `workspaceBoundPolicy` → `workspaceResolver`（单一 resolver，靠 resolve 内部区分放行/越界暂停，无需拆分）。
- `destructiveToolPolicy` → `destructiveResolver`。
- `resolvePolicy` 保留为函数，作为 `defaultResolver.resolve`。
- `isPathInWorkspace`、`extractPaths` 保留不变。

## 7. 集成点

### 7.1 `create-agent.ts`

- `AgentOptions.approvalResolver?: ApprovalResolver`（对象，不再是函数）。
- 默认注入 `defaultApprovalResolvers`；自定义 resolver 插在 `neverDenyResolver` 之后、`workspaceResolver` 之前，保证 never 保护不被破坏：

```ts
const resolvers = [
  neverDenyResolver,
  ...(config.approvalResolver ? [config.approvalResolver] : []),
  workspaceResolver,
  destructiveResolver,
  defaultResolver,
];
approvalResolver: composeResolvers(...resolvers),
```

### 7.2 `agent.ts` / `loop-agent.ts`

- `LoopAgent.approvalResolver` 字段类型改为 `ApprovalDecider`（组合后的函数），默认 `composeResolvers(...defaultApprovalResolvers)`。
- `resolveToolApprovals()` 中的调用不变（仍传 `call, tool, policy, ctx`），其后 `switch (decision.status)` 不变。

### 7.3 `index.ts` 导出

- `ApprovalResolver` 类型由「函数」变为「对象」，新增导出 `ApprovalDecider`。
- 新增导出：`neverDenyResolver`、`workspaceResolver`、`destructiveResolver`、`defaultResolver`、`defaultApprovalResolvers`。
- 移除旧函数导出：`workspaceBoundPolicy`、`destructiveToolPolicy`。
- `composeResolvers`、`resolvePolicy`、`isPathInWorkspace` 保留。

## 8. 验证场景

| 场景 | 首个命中的 resolver | 结果 |
|------|-------------------|------|
| write-tool（file_change, on-request, requires-ws, 路径在 ws） | `workspaceResolver` | approved 免审 |
| write-tool 路径越界 | `workspaceResolver` | paused |
| git-commit（mutation, requires-ws, 无路径） | `workspaceResolver` | approved 免审 |
| web-fetch（command, on-request, 非 requires-ws） | `destructiveResolver` | paused |
| policy='never'（即使 requires-ws 且路径在 ws） | `neverDenyResolver` | denied 不可覆盖 |
| read-tool（readonly, auto） | `defaultResolver` | approved |

## 9. 测试

- 单元测试 `composeResolvers`：`support` 为 false 时跳过；首个 `support` 为 true 的 resolver 决策即终态；无命中兜底 `approved`。
- 单元测试各内置 resolver 的 `support` 边界与 `resolve` 分支（无路径、路径在 ws、路径越界、`never`）。
- 验证 `resolveToolApprovals` 在 workspace 下对 write-tool 返回 approved（免审）。

## 10. 已确认的取舍

- **bash 在 workspace 下免审**：`workspaceResolver` 对「无路径参数」的 `requires-workspace` 工具（bash、git-commit）返回 approved。这是「所有 requires-workspace 工具免审」需求的必然结果，意味着模型可在 workspace 下执行任意 shell 命令而无需审批。已确认接受；如后续需收紧，可在 `workspaceResolver` 前插入一个 `commandStillRequiresApprovalResolver`（`support = kind === 'command'`）即可，无需改引擎。
- `never` 策略不可覆盖，保证「禁止即禁止」的硬约束。
