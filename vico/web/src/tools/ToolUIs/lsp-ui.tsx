/**
 * LSP 语言服务器工具 UI — 渲染 lsp 工具。
 *
 * 展示 LSP 操作结果（诊断/定义/补全/悬停），含不支持与错误提示。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import {Braces} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {LspResult} from '../lsp.tool';

/**
 * LSP 渲染器 — 展示操作结果。
 */
export const LspRenderer: ToolCallMessagePartComponent = ({
  toolName,
  status,
  result,
  isError,
  approval,
  respondToApproval,
}) => {
  const {t} = useTranslation('assistant');
  return (
    <ToolCard
      title={t('tool.lsp.title')}
      icon={Braces}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      respondToApproval={respondToApproval}
      renderResult={(r) => {
        const res = r as LspResult;
        const actionLabel = t(`tool.lsp.action.${res.action}`, {defaultValue: res.action});
        return (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground">{t('tool.lsp.operation', {action: actionLabel})}</p>
            {res.error ? (
              <p className="text-xs text-destructive whitespace-pre-wrap">{res.error}</p>
            ) : (
              <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2">
                {res.result || t('tool.lsp.noResult')}
              </pre>
            )}
            {!res.supported && <p className="text-[10px] text-muted-foreground">{t('tool.lsp.notSupported')}</p>}
          </div>
        );
      }}
    />
  );
};
