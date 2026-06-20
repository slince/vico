/**
 * Hook 事件类型。
 */
export type HookEvent =
  | 'turn:start'
  | 'turn:end'
  | 'tool:before'
  | 'tool:after'
  | 'prompt:submit'
  | 'compact:before'
  | 'compact:after';

/**
 * Hook 执行结果。
 */
export interface HookResult {
  action: 'continue' | 'modify' | 'deny';
  modifiedData?: unknown;
  message?: string;
}

/**
 * HookRunner — 生命周期 Hook 端口。
 */
export interface HookRunner {
  readonly event: HookEvent;
  run(data: unknown): Promise<HookResult>;
}
