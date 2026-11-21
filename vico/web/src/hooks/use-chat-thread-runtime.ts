/**
 * 对话线程运行时 hook — 为单个线程创建 useAgUiRuntime 实例。
 *
 * 封装 HttpAgent 创建（每次 run 前写入本线程真实 threadId）、历史适配器注入和错误处理，
 * useAssistantRuntime 的 runtimeHook 和 useTeamAssistantRuntime 共用此 hook。
 */
import {useEffect, useMemo, useRef} from 'react';
import {useAgUiRuntime} from '@assistant-ui/react-ag-ui';
import {type LanguageModelConfig, useAui, useAuiState, WebSpeechDictationAdapter} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';

import {createThreadHistoryAdapter, getInitializedThreadId} from '@/lib/thread-adapter';
import {VicoHttpAgent} from '@/lib/vico-http-agent';

/**
 * i18n 语言 → Web Speech API `SpeechRecognition.lang`（BCP-47）映射。
 */
const SPEECH_LANG_MAP: Record<string, string> = {
  en: 'en-US',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
};

/**
 * 本地草稿线程 ID 前缀（assistant-ui 在 initialize 之前使用的前端 ID）。
 */
const LOCAL_THREAD_ID_PREFIX = '__LOCALID_';

/**
 * 判断一个 ID 是否是可直接发给后端的真实线程 ID。
 */
function isRemoteThreadId(id: string | undefined): id is string {
  return !!id && !id.startsWith(LOCAL_THREAD_ID_PREFIX);
}

export interface UseChatThreadRuntimeOptions {
  /** Agent ID — Agent 详情页测试区传入（注入 modelContext → forwardedProps.agentId）；Chat 路由不传 */
  agentId?: string;
  threadId?: string;
  /** 错误回调 */
  onError?: (error: Error) => void;
}

/**
 * threadId 的注入方式：`@ag-ui/client` 的 `AbstractAgent` 在构造时就把 threadId 固化成随机 UUID，
 * assistant-ui 在 run 前还会用自己认为的值覆盖一次（新会话草稿阶段可能是空串）。唯一可靠的
 * 位置是 `VicoHttpAgent.runAgent` 的入口 —— 那里 await 本线程的 initialize，把真实 ID 写回
 * 实例属性，`HttpAgent` 的请求体随之正确（见 `@/lib/vico-http-agent`）。
 *
 * 解析优先级：已接管的 `remoteId` / URL 上的 threadId → adapter 已创建好的线程 ID → initialize。
 *
 * @param options - 配置选项
 * @returns AssistantRuntime 实例
 */
export function useChatThreadRuntime({agentId, threadId, onError}: UseChatThreadRuntimeOptions) {
  const aui = useAui();

  // 本线程条目（作用域内的 s.threadListItem，而不是全局 mainThreadId 对应的条目）：
  // 切换会话的瞬间 mainThreadId 可能还停在旧会话，用全局条目会把旧会话的 ID 当成
  // 本线程的 remoteId —— 历史适配器和发送请求都会因此串到别的会话
  const selfItem = useAuiState((state) => state.threadListItem);

  // 历史适配器用的 threadId：只用本线程的真实 ID；列表首屏加载期间才用 URL 兜底
  // （新会话草稿的 remoteId 为空，此时必须为 undefined，否则会加载到旧会话的历史）
  const selfRemoteId = isRemoteThreadId(selfItem?.remoteId) ? selfItem.remoteId : undefined;
  const isLoadingThreads = useAuiState((state) => state.threads.isLoading);
  const effectiveThreadId = selfRemoteId ?? (isLoadingThreads ? threadId : undefined);

  // 请求发出时同步读取的值：渲染期直接写 ref，避免 effect 时序晚于发送
  const threadIdRef = useRef<string | undefined>(undefined);
  threadIdRef.current = effectiveThreadId;
  const localIdRef = useRef<string | undefined>(undefined);
  localIdRef.current = selfItem?.id;

  // 历史消息适配器 — 使用 useAgUiRuntime 的 adapters.history 自动加载
  const history = useMemo(
    () => createThreadHistoryAdapter(effectiveThreadId),
    [effectiveThreadId],
  );

  // Agent 详情页测试区：把固定 agentId 注入 modelContext → forwardedProps.agentId
  useEffect(() => {
    if (!agentId) return;
    const config = { agentId } as LanguageModelConfig & { agentId?: string };
    return aui.modelContext.register({
      getModelContext: () => ({ config }),
    });
  }, [aui, agentId]);

  // 解析本线程真实 ID：run 前调用，必须同步读到已接管的值，否则才 await initialize
  const resolveThreadId = useMemo(() => async (): Promise<string | undefined> => {
    const known = threadIdRef.current;
    if (known) return known;

    const localId = localIdRef.current;
    if (!localId) return undefined;

    // initialize 已跑完（assistant-ui 在草稿阶段就会触发），直接取结果，避免重复 POST
    const created = getInitializedThreadId(localId);
    if (created) return created;

    // 草稿的真实 ID 只有 initialize 能给出；失败时把错误抛给 runtime，由上层提示，
    // 不要退回 URL 上的旧会话，否则这条消息会落进别的对话
    const {remoteId} = await aui.threadListItem.initialize();
    return isRemoteThreadId(remoteId) ? remoteId : getInitializedThreadId(localId);
  }, [aui]);

  // agent 只创建一次，解析函数通过 ref 取最新版本（aui / 线程状态会随切换变化）
  const resolveThreadIdRef = useRef(resolveThreadId);
  resolveThreadIdRef.current = resolveThreadId;

  // 为此线程创建 HttpAgent — agent 只创建一次，threadId 在每次 run 前解析并写回
  const agent = useMemo(() => {
    const http = new VicoHttpAgent(() => resolveThreadIdRef.current(), {url: '/api/v1/chat'});
    // 只把最后一条消息发给后端，历史由后端按 threadId 补全
    http.use((input, next) => next.run({...input, messages: input.messages.slice(-1)}));
    return http;
  }, []);

  // 语音听写适配器 — 识别语言跟随应用 i18n 设置，切换语言时重建
  const { i18n } = useTranslation();
  const dictation = useMemo(
    () => new WebSpeechDictationAdapter({
      language: SPEECH_LANG_MAP[i18n.language] ?? i18n.language,
      continuous: true,
      interimResults: true,
    }),
    [i18n.language],
  );

  return useAgUiRuntime({
    agent,
    adapters: { history, dictation },
    onError: (err: Error) => {
      if (err.message?.includes('401') || err.message?.includes('Unauthorized')) {
        console.warn('[chat] 流式请求收到 401/Unauthorized，会话可能失效，暂不跳转登录页', { message: err.message });
      }
      onError?.(err);
    },
  });
}
