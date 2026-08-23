/**
 * 浏览器工具 UI — 渲染 browser_navigate / snapshot / click 三个工具。
 *
 * navigate / click 为 on-request（需审批），snapshot 为只读。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {Globe, Camera, MousePointerClick} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {
  BrowserNavigateResult,
  BrowserSnapshotResult,
  BrowserClickResult,
} from '../browser.tool';

/** 工具名 → 中文标题 */
const TOOL_TITLE: Record<string, string> = {
  browser_navigate: '浏览器导航',
  browser_snapshot: '页面快照',
  browser_click: '点击元素',
};

/** 工具名 → 图标 */
const TOOL_ICON: Record<string, React.ElementType> = {
  browser_navigate: Globe,
  browser_snapshot: Camera,
  browser_click: MousePointerClick,
};

/** navigate 结果视图 — 标题 + 最终 URL */
function NavigateView({result}: {result: BrowserNavigateResult}) {
  return (
    <div className="space-y-1 text-xs">
      <p className="font-medium">{result.title || '(无标题)'}</p>
      <p className="font-mono text-[11px] text-muted-foreground break-all">{result.url}</p>
      {result.error && <p className="text-destructive">{result.error}</p>}
    </div>
  );
}

/** snapshot 结果视图 — 页面文本快照 */
function SnapshotView({result}: {result: BrowserSnapshotResult}) {
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[11px] text-muted-foreground break-all">{result.url}</p>
      {result.error ? (
        <p className="text-xs text-destructive">{result.error}</p>
      ) : (
        <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2 max-h-64 overflow-y-auto">
          {result.text}
        </pre>
      )}
    </div>
  );
}

/** click 结果视图 — 点击后的页面标题 + URL */
function ClickView({result}: {result: BrowserClickResult}) {
  return (
    <div className="space-y-1 text-xs">
      <p className="font-medium">{result.title || '(无标题)'}</p>
      <p className="font-mono text-[11px] text-muted-foreground break-all">{result.url}</p>
      {result.error && <p className="text-destructive">{result.error}</p>}
    </div>
  );
}

/**
 * 浏览器工具渲染器 — 统一处理 navigate/snapshot/click 三个工具。
 */
export const BrowserToolRenderer: ToolCallMessagePartComponent = ({
  toolName,
  status,
  args,
  result,
  isError,
  approval,
  respondToApproval,
}) => {
  const title = TOOL_TITLE[toolName] ?? toolName;
  const Icon = TOOL_ICON[toolName] ?? Globe;

  // 审批卡片补充描述（navigate / click 会触发审批）
  const approvalDescription =
    toolName === 'browser_navigate'
      ? `URL：${String((args as {url?: string})?.url ?? '')}`
      : toolName === 'browser_click'
        ? `选择器：${String((args as {selector?: string})?.selector ?? '')}`
        : undefined;

  return (
    <ToolCard
      title={title}
      icon={Icon}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      respondToApproval={respondToApproval}
      approvalDescription={approvalDescription}
      renderResult={(r) => {
        switch (toolName) {
          case 'browser_navigate':
            return <NavigateView result={r as BrowserNavigateResult} />;
          case 'browser_snapshot':
            return <SnapshotView result={r as BrowserSnapshotResult} />;
          case 'browser_click':
            return <ClickView result={r as BrowserClickResult} />;
          default:
            return null;
        }
      }}
    />
  );
};
