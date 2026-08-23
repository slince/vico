/**
 * Web 请求工具 UI — 渲染 web_fetch 工具。
 *
 * 展示 HTTP 状态行 + 响应体（截断提示 + 错误提示）。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {Globe} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {WebFetchResult} from '../web-fetch.tool';

/** HTTP 状态码着色：2xx 绿、4xx/5xx 红、其余默认 */
function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'text-green-600 dark:text-green-400';
  if (status >= 400) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

/**
 * Web 请求渲染器 — 展示状态行与响应体。
 */
export const WebFetchRenderer: ToolCallMessagePartComponent = ({
  toolName,
  status,
  result,
  isError,
  approval,
  respondToApproval,
}) => {
  return (
    <ToolCard
      title="网页请求"
      icon={Globe}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      respondToApproval={respondToApproval}
      renderResult={(r) => {
        const res = r as WebFetchResult;
        return (
          <div className="space-y-1.5">
            <p className="text-xs font-mono">
              <span className={statusClass(res.status)}>
                {res.status} {res.statusText}
              </span>
            </p>
            {res.error ? (
              <p className="text-xs text-destructive whitespace-pre-wrap">{res.error}</p>
            ) : (
              <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2 max-h-64 overflow-y-auto">
                {res.body || '(空响应体)'}
              </pre>
            )}
            {res.truncated && (
              <p className="text-[10px] text-muted-foreground">响应已截断（超过 100KB）</p>
            )}
          </div>
        );
      }}
    />
  );
};
