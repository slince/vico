/**
 * 委托工具 UI — 渲染 delegate 工具。
 *
 * 展示子 agent 的分析结果与执行步数。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import {Bot} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {DelegateResult} from '../delegate.tool';

/** 完成态结果视图 — 子 agent 结果 + 执行步数 */
function DelegateView({result}: {result: DelegateResult}) {
  const {t} = useTranslation('assistant');
  return (
    <div className="space-y-1.5">
      {result.error ? (
        <p className="text-xs text-destructive whitespace-pre-wrap">{result.error}</p>
      ) : (
        <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2 max-h-64 overflow-y-auto">
          {result.result || t('tool.delegate.noResult')}
        </pre>
      )}
      {result.steps !== undefined && (
        <p className="text-[10px] text-muted-foreground">{t('tool.delegate.steps', {steps: result.steps})}</p>
      )}
    </div>
  );
}

/**
 * 委托渲染器 — 展示子 agent 返回结果。
 */
export const DelegateRenderer: ToolCallMessagePartComponent = ({
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
      title={t('tool.delegate.title')}
      icon={Bot}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      interrupt={interrupt}
      resume={resume}
      addResult={addResult}
      respondToApproval={respondToApproval}
    >
      {result && <DelegateView result={result} />}
    </ToolCard>
  );
};
