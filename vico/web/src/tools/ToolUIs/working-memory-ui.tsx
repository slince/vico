/**
 * 工作记忆更新工具 UI — 渲染 update_working_memory 工具。
 *
 * auto mutation（无需审批），展示更新后的工作记忆 Markdown 原文 + 更新状态。
 * 标题行右侧提供展开/折叠按钮，默认折叠记忆正文。
 */
import {useState} from 'react';
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {Brain, Check, ChevronDown} from 'lucide-react';
import {cn} from '@/lib/utils';
import {ToolCard} from './tool-card';
import type {WorkingMemoryResult} from '../working-memory.tool';

/**
 * 工作记忆渲染器 — 标题右侧折叠按钮控制正文显隐。
 */
export const WorkingMemoryRenderer: ToolCallMessagePartComponent = ({
  status,
  args,
  result,
  isError,
  approval,
  respondToApproval,
}) => {
  const [open, setOpen] = useState(false);

  const memory =
    typeof (args as {memory?: string})?.memory === 'string'
      ? (args as {memory: string}).memory
      : '';

  return (
    <ToolCard
      title="更新工作记忆"
      icon={Brain}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      respondToApproval={respondToApproval}
      headerRight={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? '折叠内容' : '展开内容'}
          className="p-1 rounded hover:bg-muted transition-colors"
        >
          <ChevronDown
            size={16}
            className={cn(
              'text-muted-foreground transition-transform duration-200',
              open ? 'rotate-0' : '-rotate-90',
            )}
          />
        </button>
      }
      renderResult={(r) => {
        const res = r as WorkingMemoryResult;
        return (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <Check size={14} />
              <span>{res.status === 'updated' ? '已更新' : res.status}</span>
            </div>
            {open && (
              <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2 max-h-64 overflow-y-auto">
                {memory || '(空)'}
              </pre>
            )}
          </div>
        );
      }}
    />
  );
};
