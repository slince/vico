import {useTranslation} from 'react-i18next';
import {AssistantRuntimeProvider} from '@assistant-ui/react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Separator} from '@/components/ui/separator';
import {Thread} from '@/components/assistant-ui/thread';
import {useTeamAssistantRuntime} from '@/hooks/useTeamAssistantRuntime';

export interface TeamChatPanelProps {
  teamId: string;
}

/**
 * 团队对话测试面板
 *
 * 使用 assistant-ui Thread 组件 + useTeamAssistantRuntime（内部调用 useChatRuntime），
 * 提供团队协作的实时对话测试区域。
 */
export default function TeamChatPanel({ teamId }: TeamChatPanelProps) {
  const { t } = useTranslation('teams');

  const runtime = useTeamAssistantRuntime({ teamId });

  return (
    <Card className="flex flex-col h-[calc(100vh-14rem)]">
      <CardHeader className="pb-3">
        <CardTitle>{t('chatTitle')}</CardTitle>
        <CardDescription>{t('chatDesc')}</CardDescription>
      </CardHeader>

      <Separator />

      <CardContent className="flex-1 overflow-hidden p-0">
        {runtime && (
          <AssistantRuntimeProvider runtime={runtime}>
            <TeamChat />
          </AssistantRuntimeProvider>
        )}
      </CardContent>
    </Card>
  );
}

/** 内部组件 — 在 AssistantRuntimeProvider 内注册工具 UI 并渲染 Thread */
function TeamChat() {
  return <Thread />;
}
