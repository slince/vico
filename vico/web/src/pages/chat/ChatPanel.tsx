// 1. React
import {type FC} from 'react';

// 2. Third-party
import {useTranslation} from 'react-i18next';
import {useThreadTokenUsage} from '@assistant-ui/react-ai-sdk';
import {FolderOpen} from 'lucide-react';

// 3. Sub-components
import {Thread} from '@/components/assistant-ui/thread';
import {FileExplorerPanel} from '@/components/file-explorer/FileExplorerPanel';
import {FileTabBar} from '@/components/file-explorer/FileTabBar';
import {FileTabContent} from '@/components/file-explorer/FileTabContent';
import {useFileExplorerStore} from '@/stores/fileExplorerStore';
import {Button} from '@/components/ui/button';

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
  const { t } = useTranslation("conversations");
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
 * 右侧可切换文件浏览器面板（FileExplorerPanel）；打开的文件以 tab 形式展示。
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

export function ChatPanel({ agent, threadId }: ChatPanelProps) {
  const toggleFileExplorer = useFileExplorerStore((s) => s.toggleFileExplorer);
  const fileExplorerOpen = useFileExplorerStore((s) => s.fileExplorerOpen);
  const hasOpenTabs = useFileExplorerStore(
    (s) => (s.openTabsByThread[threadId ?? ''] ?? []).length > 0,
  );
  const activeTab = useFileExplorerStore(
    (s) => s.activeTabByThread[threadId ?? ''] ?? null,
  );

  return (
    <div className="flex-1 flex bg-background min-w-0">
      {/* 左侧：文件预览 + 会话区域（纵向堆叠） */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 文件工作区 — 顶住窗口最顶部，限制最大高度 */}
        {threadId && hasOpenTabs && (
          <div className="flex shrink-0 flex-col max-h-[45vh] min-h-[150px]">
            <FileTabBar threadId={threadId} />
            {activeTab && <FileTabContent threadId={threadId} />}
          </div>
        )}

        {/* 会话区 topbar + Thread */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="h-12 flex items-center px-4 border-b shrink-0 gap-2">
            <span className="text-sm font-medium">{agent.name}</span>
            {threadId && (
              <Button
                size="icon"
                variant={fileExplorerOpen ? 'secondary' : 'ghost'}
                onClick={toggleFileExplorer}
                title="文件浏览器"
              >
                <FolderOpen className="size-4" />
              </Button>
            )}
            <TokenUsageDisplay />
          </div>

          <div className="flex-1 min-h-0">
            <Thread
              components={{
                Welcome: () => <Welcome agentName={agent.name} />,
              }}
            />
          </div>
        </div>
      </div>

      {/* 右侧文件浏览器 — 顶住窗口最顶部 */}
      {threadId && <FileExplorerPanel threadId={threadId} />}
    </div>
  );
}
