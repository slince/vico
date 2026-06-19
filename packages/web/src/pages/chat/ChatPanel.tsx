// 1. React
import {type FC, useEffect} from 'react';

// 2. Third-party
import {useTranslation} from 'react-i18next';
import {useAui} from '@assistant-ui/react';

// 3. Sub-components
import {Thread} from '@/components/assistant-ui/thread';
import {WeatherToolRenderer} from './ToolUIs/weather-ui';
import {ExecToolRenderer} from './ToolUIs/exec-ui';

interface Agent {
  id: string;
  name: string;
}

interface ChatPanelProps {
  agent: Agent;
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
 */
export function ChatPanel({ agent }: ChatPanelProps) {
  return (
    <>
      <ToolRegistrations />
      <div className="flex-1 flex flex-col bg-background min-w-0">
        {/* 顶部标题栏 */}
        <div className="h-12 flex items-center px-4 border-b shrink-0">
          <span className="text-sm font-medium">{agent.name}</span>
        </div>

        {/* Thread 区域 */}
        <div className="flex-1 min-h-0">
          <Thread
            components={{
              Welcome: () => <Welcome agentName={agent.name} />,
            }}
          />
        </div>
      </div>
    </>
  );
}
