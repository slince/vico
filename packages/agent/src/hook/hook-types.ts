// @vico/agent - Hook system types (minimal placeholder for ToolHost dependency)

/** Hook 运行器 — 可观测性/生命周期钩子 */
export interface HookRunner {
  /** 钩子名称，如 'onToolCall' / 'onStepEnd' */
  name: string;
}
