// 1. React
import {useEffect} from 'react';

// 2. Third-party
import {ArrowUp, MessageCircle} from 'lucide-react';
import type {AssistantRuntime} from '@assistant-ui/react';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
} from '@assistant-ui/react';
import {MarkdownTextPrimitive} from '@assistant-ui/react-markdown';

// 3. UI components
import {Empty, EmptyDescription, EmptyMedia, EmptyTitle} from '@/components/ui/empty';

// 4. Sub-components
import {WeatherToolRenderer} from './ToolUIs/weather-ui';
import {ExecToolRenderer} from './ToolUIs/exec-ui';

interface AgentChatPanelProps {
  runtime: AssistantRuntime;
  agentName: string;
}

/** 注册工具渲染器 */
function ToolRegistrations() {
  const aui = useAui();

  useEffect(() => {
    const unsubWeather = aui.tools().setToolUI('get-weather', WeatherToolRenderer, {
      standalone: true,
    });
    const unsubExec = aui.tools().setToolUI(
      'mastra_workspace_execute_command',
      ExecToolRenderer,
      { standalone: true },
    );
    return () => {
      unsubWeather();
      unsubExec();
    };
  }, [aui]);

  return null;
}

/**
 * Agent 对话面板 — 已选中 Agent 时的聊天区域（Thread + Composer）。
 */
export function AgentChatPanel({ runtime, agentName }: AgentChatPanelProps) {
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ToolRegistrations />
      <div className="flex-1 flex flex-col bg-background min-w-0">
        {/* 顶部标题栏 */}
        <div className="h-12 flex items-center px-4 border-b shrink-0">
          <span className="text-sm font-medium">{agentName}</span>
        </div>

        {/* Thread 区域 */}
        <ThreadPrimitive.Root className="flex-1 flex flex-col min-h-0">
          <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-2">
            <ThreadPrimitive.Empty>
              <Empty>
                <EmptyMedia variant="icon">
                  <MessageCircle size={32} className="text-muted-foreground" />
                </EmptyMedia>
                <EmptyTitle>开始对话</EmptyTitle>
                <EmptyDescription>发送消息开始与 Agent 对话</EmptyDescription>
              </Empty>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages>
              {({ message }) => (
                <MessagePrimitive.Root
                  className={`mb-4 flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={
                      message.role === 'user'
                        ? 'max-w-[80%] rounded-lg px-3 py-2 text-sm bg-primary text-primary-foreground'
                        : 'max-w-[80%] rounded-lg px-3 py-2 text-sm bg-accent'
                    }
                  >
                    <MessagePrimitive.Parts
                      components={{
                        Text: MarkdownTextPrimitive as any,
                      }}
                    />
                  </div>
                </MessagePrimitive.Root>
              )}
            </ThreadPrimitive.Messages>
            <ThreadPrimitive.ScrollToBottom />
          </ThreadPrimitive.Viewport>

          {/* Composer 输入区域 */}
          <div className="border-t shrink-0 p-3">
            <ComposerPrimitive.Root className="flex items-end gap-2">
              <ComposerPrimitive.Input
                className="flex-1 min-h-10 max-h-40 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="输入消息..."
                autoFocus
              />
              <ComposerPrimitive.Send className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50">
                <ArrowUp size={16} />
              </ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
          </div>
        </ThreadPrimitive.Root>
      </div>
    </AssistantRuntimeProvider>
  );
}
