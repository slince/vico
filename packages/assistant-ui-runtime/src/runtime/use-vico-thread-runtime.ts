/**
 * 线程作用域的运行时 hook（`useRemoteThreadListRuntime` 的 `runtimeHook`）。
 *
 * 每个线程体挂一个 `useLocalRuntime`：历史在挂载时按本线程真实 ID 加载一次，
 * 发送前的 threadId 解析沿用已验证的三段优先级：
 *   作用域内 remoteId → 宿主注入的解析器 → `threadListItem.initialize()`。
 *
 * 这里只解决「本线程是谁」与「历史从哪来」，协议细节交由 chatModel adapter。
 */
import {useAui, useAuiState, useLocalRuntime, type AssistantRuntime} from '@assistant-ui/react';
import {useMemo, useRef} from 'react';
import {createHistoryAdapter, isRemoteThreadId} from '../history/history-adapter.js';
import {createVicoChatModelAdapter} from './chat-model-adapter.js';
import type {VicoRuntimeOptions} from '../types.js';

/** 单次 run 的 step 上限（审批续跑会新增 step，默认 50 覆盖多步场景） */
const DEFAULT_MAX_STEPS = 50;

/**
 * 创建线程作用域的 vico 运行时。
 *
 * @param options - 与 `VicoRuntimeOptions` 同构（threadList 已由外层持有）
 * @returns AssistantRuntime
 */
export function useVicoThreadRuntime(options: Omit<VicoRuntimeOptions, 'threadList'>): AssistantRuntime {
  const aui = useAui();

  // 本线程条目（作用域内的 threadListItem，而不是全局 mainThreadId 对应的条目）：
  // 切换会话的瞬间 mainThreadId 可能还停在旧会话，用全局条目会把旧会话的 ID 当成
  // 本线程的 remoteId —— 历史加载和发送请求都会因此串到别的会话
  const selfItem = useAuiState((state) => state.threadListItem);
  const isLoadingThreads = useAuiState((state) => state.threads.isLoading);

  // 历史加载用的 threadId：只认本线程条目自己的 remoteId。
  // 草稿（status==='new'）的 remoteId 为空，此时必须为 undefined —— 否则会读到 URL 上旧会话的历史，
  // 而本地 runtime 一旦导入旧消息就不会再清空（没有 scopeId 重置）。
  // 仅当条目还没拿到（列表首屏加载）时，才用宿主注入的 URL threadId 兜底。
  const selfRemoteId = isRemoteThreadId(selfItem?.remoteId) ? selfItem.remoteId : undefined;
  const effectiveThreadId = selfItem ? selfRemoteId : isLoadingThreads ? options.threadId : undefined;

  // 请求发出时同步读取的值：渲染期直接写 ref，避免 effect 时序晚于发送
  const threadIdRef = useRef<string | undefined>(undefined);
  threadIdRef.current = effectiveThreadId;
  const localIdRef = useRef<string | undefined>(undefined);
  localIdRef.current = selfItem?.id;

  // 宿主可注入更精确的解析器（如共享 initialize 缓存的场景）；默认走 initialize
  const resolveThreadId = useMemo(() => {
    if (options.resolveThreadId) return options.resolveThreadId;
    return async (): Promise<string | undefined> => {
      const known = threadIdRef.current;
      if (known) return known;

      const localId = localIdRef.current;
      if (!localId) return undefined;

      // 草稿的真实 ID 只有 initialize 能给出；失败时把错误抛给 runtime，由上层提示，
      // 不要退回 URL 上的旧会话，否则这条消息会落进别的对话
      const {remoteId} = await aui.threadListItem.initialize();
      return isRemoteThreadId(remoteId) ? remoteId : undefined;
    };
  }, [aui, options.resolveThreadId]);

  // 历史适配器：threadId 变化（列表加载完成 / 新会话 initialize 完成）时重建
  const history = useMemo(
    () => createHistoryAdapter({transport: options.transport, threadId: effectiveThreadId}),
    [options.transport, effectiveThreadId],
  );

  const chatModel = useMemo(
    () =>
      createVicoChatModelAdapter({
        transport: options.transport,
        resolveThreadId,
        agentId: options.agentId,
        // 运行配置由宿主各选择器注册进 modelContext，读取时机必须在发送当刻
        getConfig: () => {
          const config = aui.modelContext.getModelContext().config;
          return config as Record<string, unknown> | undefined;
        },
        onThreadId: (id) => options.onThreadIdChange?.(id),
        onError: options.onError,
      }),
    [aui, options.transport, options.agentId, options.onThreadIdChange, options.onError, resolveThreadId],
  );

  const runtime = useLocalRuntime(chatModel, {
    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
    // 不设 scopeId（local runtime 的 scopeId 选项不生效；history.scopeId 变化又会 cancelRun，
    // 会在草稿拿到真实 ID 时打断首轮请求）。每个线程体各自挂一个 runtime，
    // 会话隔离靠「历史只按本线程 remoteId 加载」保证。
    adapters: {
      history,
      ...(options.adapters?.dictation !== undefined && {dictation: options.adapters.dictation}),
      ...(options.adapters?.attachments !== undefined && {attachments: options.adapters.attachments}),
    },
  });

  return runtime;
}
