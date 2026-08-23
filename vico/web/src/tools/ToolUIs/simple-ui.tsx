/**
 * 简单工具 UI — 渲染 echo / now / todo_write 三个工具。
 *
 * 三者均为 auto（无需审批）：echo 回显文本、now 显示时间、todo_write 渲染任务清单。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import {Quote, Clock, ListChecks} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {EchoResult, NowResult, TodoWriteResult} from '../simple.tool';

/** 工具名 → 图标 */
const TOOL_ICON: Record<string, React.ElementType> = {
  echo: Quote,
  now: Clock,
  todo_write: ListChecks,
};

/** todo 任务状态 → 展示颜色（tailwind 语义） */
const TODO_STATUS_COLOR: Record<string, string> = {
  pending: 'text-muted-foreground',
  in_progress: 'text-amber-600 dark:text-amber-400',
  completed: 'text-green-600 dark:text-green-400',
};

/** echo 结果视图 */
function EchoView({result}: {result: EchoResult}) {
  return (
    <p className="text-xs text-muted-foreground whitespace-pre-wrap break-all">{result.message}</p>
  );
}

/** now 结果视图 */
function NowView({result}: {result: NowResult}) {
  return <p className="font-mono text-xs">{result.datetime}</p>;
}

/** todo_write 结果视图 — 任务列表 + 汇总 */
function TodoView({result}: {result: TodoWriteResult}) {
  const {t} = useTranslation('assistant');
  return (
    <div className="space-y-1.5">
      {result.tasks.length > 0 ? (
        <ul className="space-y-1">
          {result.tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2 text-xs">
              <span className={`shrink-0 ${TODO_STATUS_COLOR[task.status] ?? 'text-muted-foreground'}`}>●</span>
              <span className={`truncate ${task.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>
                {task.content}
              </span>
              <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                {t(`tool.simple.status.${task.status}`, {defaultValue: task.status})}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t('tool.simple.noTasks')}</p>
      )}
      <p className="text-[10px] text-muted-foreground">{result.summary}</p>
    </div>
  );
}

/**
 * 简单工具渲染器 — 统一处理 echo/now/todo_write 三个工具。
 */
export const SimpleToolRenderer: ToolCallMessagePartComponent = ({
  toolName,
  status,
  result,
  isError,
  approval,
  interrupt,
  resume,
  addResult,
  respondToApproval,
}) => {
  const {t} = useTranslation('assistant');
  const title = t(`tool.simple.title.${toolName}`, {defaultValue: toolName});
  const Icon = TOOL_ICON[toolName] ?? Quote;

  return (
    <ToolCard
      title={title}
      icon={Icon}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      interrupt={interrupt}
      resume={resume}
      addResult={addResult}
      respondToApproval={respondToApproval}
      renderResult={(r) => {
        switch (toolName) {
          case 'echo':
            return <EchoView result={r as EchoResult} />;
          case 'now':
            return <NowView result={r as NowResult} />;
          case 'todo_write':
            return <TodoView result={r as TodoWriteResult} />;
          default:
            return null;
        }
      }}
    />
  );
};
