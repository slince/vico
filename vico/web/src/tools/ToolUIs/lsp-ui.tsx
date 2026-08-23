/**
 * LSP 语言服务器工具 UI — 渲染 lsp 工具。
 *
 * 展示 LSP 操作结果（诊断/定义/补全/悬停），含不支持与错误提示。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {Braces} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {LspResult} from '../lsp.tool';

/** LSP action → 中文标题 */
const ACTION_LABEL: Record<string, string> = {
  diagnostics: '诊断',
  go_to_definition: '跳转定义',
  completions: '代码补全',
  hover: '悬停信息',
};

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
  return (
    <ToolCard
      title="LSP 语言服务"
      icon={Braces}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      respondToApproval={respondToApproval}
      renderResult={(r) => {
        const res = r as LspResult;
        const actionLabel = ACTION_LABEL[res.action] ?? res.action;
        return (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground">操作：{actionLabel}</p>
            {res.error ? (
              <p className="text-xs text-destructive whitespace-pre-wrap">{res.error}</p>
            ) : (
              <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2">
                {res.result || '(无结果)'}
              </pre>
            )}
            {!res.supported && <p className="text-[10px] text-muted-foreground">当前语言服务器不支持此操作</p>}
          </div>
        );
      }}
    />
  );
};
