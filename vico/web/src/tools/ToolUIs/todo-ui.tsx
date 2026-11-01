/**
 * 任务清单工具 UI — 渲染 todo_write 工具（auto，无需审批）。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {ListChecks} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {TodoWriteArgs, TodoWriteResult} from '../simple.tool';

/** todo 任务状态 → 展示颜色（tailwind 语义） */
const TODO_STATUS_COLOR: Record<string, string> = {
  pending: 'text-muted-foreground',
  in_progress: 'text-amber-600 dark:text-amber-400',
  completed: 'text-green-600 dark:text-green-400',
};

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
 * 任务清单渲染器 — 渲染 todo_write 工具的结果。
 */
export const TodoWriteRenderer: ToolCallMessagePartComponent<TodoWriteArgs, TodoWriteResult> = ({
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

  return (
    <ToolCard
      title={t('tool.simple.title.todo_write')}
      icon={ListChecks}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      interrupt={interrupt}
      resume={resume}
      addResult={addResult}
      respondToApproval={respondToApproval}
    >
      {result && <TodoView result={result} />}
    </ToolCard>
  );
};
