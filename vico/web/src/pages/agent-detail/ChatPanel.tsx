import {useTranslation} from 'react-i18next';
import {AssistantRuntimeProvider} from '@assistant-ui/react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Separator} from '@/components/ui/separator';
import {Thread} from '@/components/assistant-ui/thread';
import {useAssistantRuntime} from '@/hooks/useAssistantRuntime';

export interface ChatPanelProps {
  agentId: string;
}

/**
 * 测试对话面板
 *
 * 使用 assistant-ui Thread 组件 + useAssistantRuntime（内部调用 useChatRuntime），
 * 提供 Agent 的实时对话测试区域。
 */
export default function ChatPanel({ agentId }: ChatPanelProps) {
  const { t } = useTranslation('agents');

  const runtime = useAssistantRuntime({ agentId });

  return (
    <div className="mt-4">
      <Card className="flex flex-col h-[calc(100vh-14rem)]">
        <CardHeader className="pb-3">
          <CardTitle>{t('chatPreview')}</CardTitle>
          <CardDescription>{t('chatPreviewDesc')}</CardDescription>
        </CardHeader>

        <Separator />

        <CardContent className="flex-1 overflow-hidden p-0">
          {runtime && (
            <AssistantRuntimeProvider runtime={runtime}>
              <AgentChat />
            </AssistantRuntimeProvider>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** 内部组件 — 在 AssistantRuntimeProvider 内注册工具 UI 并渲染 Thread */
function AgentChat() {
  return <Thread />;
}
