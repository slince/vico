/**
 * `useVicoRuntime`：vico 协议下的 assistant-ui 运行时入口。
 *
 * 只接管消息与 run 这一层（chatModel / history），线程列表 adapter 由宿主注入，
 * 因为列表加载依赖宿主的请求层、缓存失效与业务 store（workspace / agent 归属等）。
 */
import {useRemoteThreadListRuntime, type AssistantRuntime} from '@assistant-ui/react';
import {useVicoThreadRuntime} from './runtime/use-vico-thread-runtime.js';
import type {VicoRuntime, VicoRuntimeOptions} from './types.js';

/**
 * 创建 vico 协议的 AssistantRuntime。
 *
 * @param options - 传输实现、线程列表 adapter、可选 threadId 与 adapters
 * @returns AssistantRuntime（可直接交给 `AssistantRuntimeProvider`）
 */
export function useVicoRuntime(options: VicoRuntimeOptions): VicoRuntime {
  const {transport, threadList, threadId, agentId, adapters, onThreadIdChange, onError, maxSteps} = options;

  const runtime: AssistantRuntime = useRemoteThreadListRuntime({
    adapter: threadList,
    ...(threadId !== undefined && {threadId}),
    ...(onThreadIdChange !== undefined && {onThreadIdChange}),
    runtimeHook: () =>
      useVicoThreadRuntime({
        transport,
        ...(threadId !== undefined && {threadId}),
        ...(agentId !== undefined && {agentId}),
        ...(adapters !== undefined && {adapters}),
        ...(onThreadIdChange !== undefined && {onThreadIdChange}),
        ...(onError !== undefined && {onError}),
        ...(maxSteps !== undefined && {maxSteps}),
      }),
  });

  return runtime;
}
