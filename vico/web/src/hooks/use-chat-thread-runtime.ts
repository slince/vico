/**
 * 对话线程运行时 hook — 为单个线程创建 useAgUiRuntime 实例。
 *
 * 封装 HttpAgent 创建、历史适配器注入、onRunFinished threadId 回写和错误处理，
 * useAssistantRuntime 的 runtimeHook 和 useTeamAssistantRuntime 共用此 hook。
 */
import {useEffect, useMemo, useRef} from 'react';
import {HttpAgent} from '@ag-ui/client';
import {useAgUiRuntime} from '@assistant-ui/react-ag-ui';
import {useAui, useAuiState, WebSpeechDictationAdapter, type LanguageModelConfig} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';

import {createThreadHistoryAdapter} from '@/lib/thread-adapter';

/**
 * i18n 语言 → Web Speech API `SpeechRecognition.lang`（BCP-47）映射。
 */
const SPEECH_LANG_MAP: Record<string, string> = {
  en: 'en-US',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
};

export interface UseChatThreadRuntimeOptions {
  /** Agent ID — Agent 详情页测试区传入（注入 modelContext → forwardedProps.agentId）；Chat 路由不传 */
  agentId?: string;
  /** 首次对话创建 thread 后的回调 */
  onThreadCreated?: (threadId: string) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
}

/**
 * 为指定线程创建 AssistantRuntime（ag-ui 协议）。
 *
 * @param options - 配置选项
 * @returns AssistantRuntime 实例
 */
export function useChatThreadRuntime({agentId, onThreadCreated, onError}: UseChatThreadRuntimeOptions) {
  // 线程真实 ID（initialize 预创建后写入 remoteId；本地临时 ID 时为 undefined）
  const remoteId = useAuiState((state) => state.threadListItem.remoteId);

  // 历史消息适配器 — 使用 useAgUiRuntime 的 adapters.history 自动加载
  const history = useMemo(
    () => createThreadHistoryAdapter(remoteId),
    [remoteId],
  );

  // 用 ref 持有 onThreadCreated，避免订阅闭包捕获旧引用
  const onThreadCreatedRef = useRef(onThreadCreated);
  onThreadCreatedRef.current = onThreadCreated;

  // Agent 详情页测试区：把固定 agentId 注入 modelContext → forwardedProps.agentId
  const aui = useAui();
  useEffect(() => {
    if (!agentId) return;
    const config = { agentId } as LanguageModelConfig & { agentId?: string };
    return aui.modelContext.register({
      getModelContext: () => ({ config }),
    });
  }, [aui, agentId]);

  // 为此线程创建 HttpAgent — 自定义 fetch 注入 credentials（session cookie）
  const agent = useMemo(() => {
    const http = new HttpAgent({
      url: '/api/v1/chat',
      threadId: remoteId,
      fetch: (url, init) => fetch(url, { ...init, credentials: 'include' }),
    });
    // 只把最后一条消息发给后端，历史由后端按 threadId 补全
    http.use((input, next) => next.run({ ...input, messages: input.messages.slice(-1) }));
    // RUN_FINISHED 时回写服务端真实 threadId（服务端新建线程的兜底路径）
    http.subscribe({
      onRunFinishedEvent: ({ event }) => {
        const newThreadId = event.threadId;
        if (newThreadId && newThreadId !== remoteId) {
          onThreadCreatedRef.current?.(newThreadId);
        }
      },
    });
    return http;
  }, [remoteId]);

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
