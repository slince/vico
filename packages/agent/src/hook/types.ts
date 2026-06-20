// @vico/agent - Hook module type definitions

/** 生命周期钩子事件类型 */
export type HookEvent =
  | 'turn:start'
  | 'turn:end'
  | 'tool:before'
  | 'tool:after'
  | 'prompt:submit'
  | 'compact:before'
  | 'compact:after';

/** 钩子执行结果 */
export interface HookResult {
  /** 决策动作 */
  action: 'continue' | 'modify' | 'deny';
  /** 修改后的数据（action 为 modify 时提供） */
  modifiedData?: unknown;
  /** 附加消息 */
  message?: string;
}

/** 钩子运行器端口 — 生命周期事件拦截与干预 */
export interface HookRunner {
  /** 钩子绑定的事件类型 */
  event: HookEvent;
  /** 执行钩子逻辑，传入当前上下文数据，返回处理决策 */
  run(data: unknown): Promise<HookResult>;
}
