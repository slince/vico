/**
 * 语义记忆更新工具 UI — 渲染 update_semantic_memory 工具。
 *
 * auto mutation（无需审批），按 mode 分三种视图：
 * - append：展示追加内容 + 更新状态；
 * - replace：展示被替换片段（target）与替换后内容（replacement）；
 * - overwrite：展示完整新记忆 Markdown + 更新状态。
 * 折叠能力由共享 ToolCard 统一提供。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {ArrowDown, Brain, Check} from 'lucide-react';
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

/** replace 结果视图 — 被替换内容（红）→ 替换后内容（绿） */
function ReplaceView({target, replacement}: {target: string; replacement: string}) {
  const {t} = useTranslation('assistant');
  return (
    <div className="space-y-1">
      <div>
        <p className="mb-1 text-[11px] font-medium text-red-600 dark:text-red-400">
          {t('tool.semanticMemory.replaced')}
        </p>
        <MemoryBlock content={target} emptyLabel={t('tool.semanticMemory.empty')} />
      </div>

      <div className="flex justify-center text-muted-foreground">
        <ArrowDown size={14} />
      </div>

      <div>
        <p className="mb-1 text-[11px] font-medium text-green-600 dark:text-green-400">
          {t('tool.semanticMemory.replacedWith')}
        </p>
        <MemoryBlock content={replacement} emptyLabel={t('tool.semanticMemory.deleted')} />
      </div>
    </div>
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
            <ReplaceView target={args.target} replacement={args.replacement} />
          )}
        </div>
      )}
    </ToolCard>
  );
};
