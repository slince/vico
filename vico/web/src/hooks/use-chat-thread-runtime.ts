/**
 * 对话线程运行时 hook — 为单个线程创建 useAgUiRuntime 实例。
 *
 * 封装 HttpAgent 创建（threadId 在 HTTP 请求发出前解析，新会话会先创建后端线程）、
 * 历史适配器注入和错误处理，useAssistantRuntime 的 runtimeHook 和 useTeamAssistantRuntime 共用此 hook。
 */
import {useEffect, useMemo, useRef} from 'react';
import {HttpAgent, type HttpAgentFetchFn} from '@ag-ui/client';
import {useAgUiRuntime} from '@assistant-ui/react-ag-ui';
import {type LanguageModelConfig, useAui, useAuiState, WebSpeechDictationAdapter} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';

import {clearRecentlyCreatedThread, createThreadHistoryAdapter, getRecentlyCreatedThread} from '@/lib/thread-adapter';

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

type AuiClient = ReturnType<typeof useAui>;

/**
 * 判断一个 ID 是否是可直接发给后端的真实线程 ID。
 */
function isRemoteThreadId(id: string | undefined): id is string {
  return !!id && !id.startsWith(LOCAL_THREAD_ID_PREFIX);
}

/**
 * 在 HTTP 请求真正发出前解析（必要时创建）本线程的后端 ID。
 *
 * 不能使用渲染期或 store 快照里的值：`@ag-ui/client` 的 `AbstractAgent` 在构造时就把 threadId
 * 固化成随机 UUID，assistant-ui 的线程条目在 `initialize()` 发起时又会把草稿乐观改成
 * `regular`（此时 `remoteId` 仍为空），所以同步读 `threads`/`threadItems` 只能读到旧 ID 或空串。
 * 唯一权威来源是 `aui.threadListItem.initialize()` 的返回值 —— 它对该草稿只会创建一次线程
 * （adapter 侧另有同草稿的任务缓存兜底），因此这里直接 await 它。
 *
 * @param aui - 当前线程作用域的 AssistantClient（`threadListItem` 已绑定到本线程）
 * @param routeThreadId - URL 上的 threadId，仅在条目尚未进入线程列表时兜底
 * @returns 真实 threadId；都拿不到时返回空串，交由后端新建线程
 */
async function ensureThreadId(aui: AuiClient, routeThreadId?: string): Promise<string> {
  const item = aui.threadListItem.getState() as
    | { id: string; remoteId?: string; status: string }
    | undefined;

  if (isRemoteThreadId(item?.remoteId)) return item.remoteId;

  // adapter 侧已创建好、但列表状态还没接管的窗口（等 React 提交才会反映到 store）
  const created = getRecentlyCreatedThread();
  if (created && (!item || created.localId === item.id)) return created.remoteId;

  // 条目还没进列表（如刷新后直接进 /chat/:id、列表尚未加载）：按 URL 的会话走
  if (!item) return routeThreadId ?? '';

  try {
    const {remoteId} = await aui.threadListItem.initialize();
    if (isRemoteThreadId(remoteId)) return remoteId;
    console.warn('[chat] 初始化线程未返回 remoteId，本次请求按新建会话处理', {remoteId});
  } catch (error) {
    console.warn('[chat] 初始化线程失败', error);
    // 草稿初始化失败时绝不能退回 URL 上的旧会话，否则这条消息会落进别的对话；
    // 退回空串让后端新建线程，至少不污染已有对话
    if (item.status === 'new') return '';
  }
  return routeThreadId ?? '';
}

export interface UseChatThreadRuntimeOptions {
  /** Agent ID — Agent 详情页测试区传入（注入 modelContext → forwardedProps.agentId）；Chat 路由不传 */
  agentId?: string;
  threadId?: string;
  /** 错误回调 */
  onError?: (error: Error) => void;
}

/**
 * 为指定线程创建 AssistantRuntime（ag-ui 协议）。
 *
 * @param options - 配置选项
 * @returns AssistantRuntime 实例
 */
export function useChatThreadRuntime({agentId, threadId, onError}: UseChatThreadRuntimeOptions) {
  const aui = useAui();

  // 主线程条目（整条读取，含 status）：新会话草稿与真实会话要区分对待
  // 读 threads 而非 threadListItem（后者订阅在 reconcile 后不刷新）
  const mainThreadItem = useAuiState((state) =>
    state.threads.threadItems.find((i) => i.id === state.threads.mainThreadId),
  );

  // 历史适配器用的 threadId：允许滞后于 store（只影响首次 load / 切换会话）
  // 条目存在但没有真实 ID（新会话草稿 / initialize 进行中）时不能回退 URL 的旧会话，
  // 只有列表首屏加载期间的占位草稿才用 URL
  const mainRemoteId = mainThreadItem?.remoteId;
  const isLoadingThreads = useAuiState((state) => state.threads.isLoading);
  const effectiveThreadId = isRemoteThreadId(mainRemoteId)
    ? mainRemoteId
    : mainThreadItem
      ? isLoadingThreads
        ? threadId
        : undefined
      : threadId;

  // 列表状态已经拿到真实 ID 后清掉桥接值，避免影响下一个新会话
  useEffect(() => {
    if (isRemoteThreadId(mainThreadItem?.remoteId)) clearRecentlyCreatedThread();
  }, [mainThreadItem]);

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

  // 请求发出时实时解析 threadId，因此 ref 持有最新的 aui / routeThreadId，agent 本身不重建
  const auiRef = useRef(aui);
  auiRef.current = aui;
  const routeThreadIdRef = useRef(threadId);
  routeThreadIdRef.current = threadId;

  // 为此线程创建 HttpAgent — threadId 在 HTTP 请求发出前注入请求体（不在构造时固化）
  const agent = useMemo(() => {
    // HttpAgent 用构造时固化的 threadId 生成请求体（默认是随机 UUID），middleware 只能改内存里的
    // input；真正能「等到真实 ID 再发」的时机是 fetch。这里先 await 线程 ID，再改写请求体。
    const fetchWithThreadId: HttpAgentFetchFn = async (url, init) => {
      const resolvedThreadId = await ensureThreadId(auiRef.current, routeThreadIdRef.current);
      let nextInit = init;
      if (typeof init.body === 'string') {
        try {
          const payload = JSON.parse(init.body) as { threadId?: string };
          nextInit = {...init, body: JSON.stringify({...payload, threadId: resolvedThreadId})};
        } catch {
          // 请求体不是 JSON 时原样发送
        }
      }
      return fetch(url, nextInit);
    };

    const http = new HttpAgent({url: '/api/v1/chat', fetch: fetchWithThreadId});
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
