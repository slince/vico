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

