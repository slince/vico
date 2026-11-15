/**
 * 语义记忆更新工具 UI — 渲染 update_semantic_memory 工具。
 *
 * auto mutation（无需审批），按 mode 分三种视图：
 * - append：展示追加内容 + 更新状态；
 * - replace：以 diff 形式展示被替换片段（- 行）与替换后内容（+ 行）；
 * - overwrite：展示完整新记忆 Markdown + 更新状态。
 * 折叠能力由共享 ToolCard 统一提供。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {Brain, Check} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {SemanticMemoryArgs, SemanticMemoryResult} from '../semantic-memory.tool';

/** 完成态状态行 — 绿色勾选 + 更新状态文案 */
function UpdatedStatus() {
  const {t} = useTranslation('assistant');
  return (
    <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
      <Check size={14} />
      <span>{t('tool.semanticMemory.updated')}</span>
    </div>
  );
}

/** Markdown 原文块 — 统一 mono 样式，空内容回退 emptyLabel */
function MemoryBlock({content, emptyLabel}: {content: string; emptyLabel: string}) {
  return (
    <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2 max-h-64 overflow-y-auto">
      {content || emptyLabel}
    </pre>
  );
}

/** replace 结果视图 — 类似文件 diff：被替换片段 - 行（红），替换后内容 + 行（绿） */
function ReplaceDiff({target, replacement}: {target: string; replacement: string}) {
  return (
    <pre className="text-[11px] leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2">
      {target.split('\n').map((line, i) => (
        <div key={`del-${i}`} className="text-red-600 dark:text-red-400">
          {`- ${line || ' '}`}
        </div>
      ))}
      {replacement !== '' &&
        replacement.split('\n').map((line, i) => (
          <div key={`add-${i}`} className="text-green-600 dark:text-green-400">
            {`+ ${line || ' '}`}
          </div>
        ))}
    </pre>
  );
}

/**
 * 语义记忆渲染器 — 按 mode 展示本次写入/替换的记忆内容。
 */
export const SemanticMemoryRenderer: ToolCallMessagePartComponent<SemanticMemoryArgs, SemanticMemoryResult> = ({
  status,
  args,
  result,
  isError,
  approval,
  interrupt,
  resume,
  addResult,
  respondToApproval,
}) => {
  const {t} = useTranslation('assistant');

  // 审批态内容：按 mode 展示本次要写入/替换的记忆原文（replace 以 -/+ 行区分删除与新增）
  const approvalCommand = args
    ? args.mode === 'replace'
      ? `- ${args.target}\n+ ${args.replacement}`
      : args.memory
    : undefined;

  return (
    <ToolCard
      title={t('tool.semanticMemory.title')}
      icon={Brain}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      interrupt={interrupt}
      resume={resume}
      addResult={addResult}
      respondToApproval={respondToApproval}
      approvalCommand={approvalCommand}
    >
      {result && args && (
        <div className="space-y-1.5">
          <UpdatedStatus />

          {args.mode === 'append' && (
            <MemoryBlock content={args.memory} emptyLabel={t('tool.semanticMemory.empty')} />
          )}

          {args.mode === 'overwrite' && (
            <MemoryBlock content={args.memory} emptyLabel={t('tool.semanticMemory.empty')} />
          )}

          {args.mode === 'replace' && (
            <ReplaceDiff target={args.target} replacement={args.replacement} />
          )}
        </div>
      )}
    </ToolCard>
  );
};
