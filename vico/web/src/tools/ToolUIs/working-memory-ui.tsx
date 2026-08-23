/**
 * 工作记忆更新工具 UI — 渲染 update_working_memory 工具。
 *
 * auto mutation（无需审批），展示更新后的工作记忆 Markdown 原文 + 更新状态。
 * 折叠能力由共享 ToolCard 统一提供。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {Brain, Check} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {WorkingMemoryResult} from '../working-memory.tool';

/**
 * 工作记忆渲染器 — 展示本次写入的记忆内容。
 */
export const WorkingMemoryRenderer: ToolCallMessagePartComponent = ({
  status,
  args,
  result,
  isError,
  approval,
  respondToApproval,
}) => {
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
      renderResult={(r) => {
        const res = r as WorkingMemoryResult;
        return (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <Check size={14} />
              <span>{res.status === 'updated' ? '已更新' : res.status}</span>
            </div>
            <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2 max-h-64 overflow-y-auto">
              {memory || '(空)'}
            </pre>
          </div>
        );
      }}
    />
  );
};
