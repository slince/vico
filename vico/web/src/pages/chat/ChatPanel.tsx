// 1. React
import {type FC} from 'react';

// 2. Third-party
import {useTranslation} from 'react-i18next';
import {useThreadTokenUsage} from '@assistant-ui/react-ai-sdk';
import {FolderTree} from 'lucide-react';

// 3. Sub-components
import {Thread} from '@/components/assistant-ui/elements/thread.aui';
import {FileExplorerPanel} from '@/pages/chat/FileExplorerPanel';
import {useFileExplorerStore} from '@/stores/fileExplorerStore';
import {BASE_FONT_SIZE, useFontSize} from '@/hooks/use-font-size';
import {Button} from '@/components/ui/button';
import {AuiConfig, AuiProvider, Suggestions, useAui} from "@assistant-ui/react";

/** 格式化 token 数量为可读字符串 */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${tokens}`;
}

interface Agent {
  id: string;
  name: string;
}

interface ChatPanelProps {
  agent: Agent;
  threadId?: string;
}

/** 自定义欢迎组件，显示 Agent 名称 */
const Welcome: FC<{ agentName: string }> = ({ agentName }) => {
  const { t } = useTranslation("threads");
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-semibold duration-200">
        {agentName}
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">
        {t("chatStartHint")}
      </p>
    </div>
  );
};

/**
 * Agent 对话面板 — 已选中 Agent 时的聊天区域。
 *
 * 使用 assistant-ui 的 Thread 组件替代手动组装的 ThreadPrimitive + ComposerPrimitive。
 * AssistantRuntimeProvider 由父组件 Chat 提供，此组件仅注册工具并渲染 Thread。
 *
 * 聊天区只负责纯对话；右侧为多视图面板（FileExplorerPanel，含文件树 / 预览 / 终端）。
 */
/** 顶部标题栏内的 Token 用量显示 */
const TokenUsageDisplay: FC = () => {
  const usage = useThreadTokenUsage();
  if (!usage || usage.totalTokens === undefined || usage.totalTokens === 0) return null;

  return (
    <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
      {formatTokens(usage.totalTokens)} tokens
    </span>
  );
};


function ThreadWithSuggestions({agent}: ChatPanelProps) {
  const aui = useAui();
  const config = AuiConfig({
    suggestions: Suggestions([]),
  });
  return (
    <AuiProvider extends={aui} config={config}>
      <Thread
        components={{
          Welcome: () => <Welcome agentName={agent.name} />,
        }}
      />
    </AuiProvider>
  );
}

export function ChatPanel({ agent, threadId }: ChatPanelProps) {
  const toggleFileExplorer = useFileExplorerStore((s) => s.toggleFileExplorer);
  const fileExplorerOpen = useFileExplorerStore((s) => s.fileExplorerOpen);
  const { fontSize } = useFontSize();

  return (
    <div className="flex-1 flex bg-background min-w-0">
      {/* 左侧：topbar + 对话内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部工具栏 — 始终显示 */}
        <div className="h-12 flex items-center px-4 border-b shrink-0 gap-2">
          <span className="text-sm font-medium">{agent.name}</span>
          <TokenUsageDisplay />
          {threadId && (
            <Button
              size="icon"
              variant={fileExplorerOpen ? 'secondary' : 'ghost'}
              onClick={toggleFileExplorer}
              title="文件浏览器"
              className="ml-auto"
            >
              <FolderTree className="size-4" />
            </Button>
          )}
        </div>

        {/* 内容区：纯对话 — zoom 只作用于会话区文字，不影响右侧面板 */}
        <div className="flex-1 min-h-0" style={{ zoom: fontSize / BASE_FONT_SIZE }}>
          <ThreadWithSuggestions agent={agent} threadId={threadId} />
        </div>
      </div>

      {/* 右侧多视图面板（文件树 / 预览 / 终端） — 顶住窗口最顶部 */}
      {threadId && <FileExplorerPanel threadId={threadId} />}
    </div>
  );
}
