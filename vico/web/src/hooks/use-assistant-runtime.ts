/**
 * Assistant UI Runtime hook — vico 协议运行时（`useVicoRuntime`）+ 远程线程列表。
 *
 * 与 Chat.tsx 中 AssistantRuntimeProvider 配合使用：
 * - 线程列表 adapter 由本 hook 注入（依赖 react-query 失效与业务 store）
 * - 消息流 / 历史 / 审批续跑全部交给 `@vico/assistant-ui-runtime`
 * - 新会话创建后经 `onThreadIdChange` 回写路由
 */
import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {WebSpeechDictationAdapter} from '@assistant-ui/react';
import {createSseTransport, useVicoRuntime} from '@vico/assistant-ui-runtime';
import {createThreadListAdapter} from '@/lib/thread-adapter';

/**
 * i18n 语言 → Web Speech API `SpeechRecognition.lang`（BCP-47）映射。
 */
const SPEECH_LANG_MAP: Record<string, string> = {
  en: 'en-US',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
};

export interface UseAssistantRuntimeOptions {
  /** 固定 Agent ID（Agent 详情页测试对话区传入）；Chat 路由不传，由 composer 选中态决定 */
  agentId?: string;
  /** 可选的 thread ID，用于加载历史消息和继续对话 */
  threadId?: string;
  /** 首次对话创建 thread 后的回调 */
  onThreadCreated?: (threadId: string) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
  /** 是否启用运行时与线程列表请求，非 Chat 路由关闭 */
  enabled?: boolean;
}

/**
 * 创建 Assistant UI 聊天运行时。
 *
 * @param options - 配置选项
 * @returns AssistantRuntime 实例；enabled 为 false 时返回 null
 */
export function useAssistantRuntime({
  agentId,
  threadId,
  onThreadCreated,
  onError,
  enabled = true,
}: UseAssistantRuntimeOptions) {
  // 线程列表适配器 — 传入 agentId 时按该 Agent 过滤；否则列出全部线程
  const threadList = useMemo(() => createThreadListAdapter(agentId, enabled), [agentId, enabled]);

  // 传输层：默认走 /api/v1/chat（vico 协议 SSE）
  const transport = useMemo(() => createSseTransport(), []);

  // 语音听写适配器 — 识别语言跟随应用 i18n 设置，切换语言时重建
  const {i18n} = useTranslation();
  const dictation = useMemo(
    () =>
      new WebSpeechDictationAdapter({
        language: SPEECH_LANG_MAP[i18n.language] ?? i18n.language,
        continuous: true,
        interimResults: true,
      }),
    [i18n.language],
  );

  const runtime = useVicoRuntime({
    transport,
    threadList,
    ...(agentId !== undefined && {agentId}),
    ...(threadId !== undefined && {threadId}),
    adapters: {dictation},
    // 线程真实 ID 变化（新建会话 initialize 成功 / 切换会话）时回写路由：
    // 受控 threadId 一旦停在旧会话，下一次发送就可能带着旧 ID
    onThreadIdChange: (newThreadId) => {
      if (!newThreadId) return;
      onThreadCreated?.(newThreadId);
    },
    ...(onError !== undefined && {onError}),
  });

  return enabled ? runtime : null;
}
