/**
 * 内容搜索工具 UI — 渲染 grep 只读工具（正则搜索结果）。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {Search} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {GrepArgs, GrepResult} from '../filesystem.tool';

/** grep 结果视图 — 搜索结果文本 */
function GrepView({result}: {result: GrepResult}) {
  const {t} = useTranslation('assistant');
  return (
    <div className="space-y-1">
      {result.count > 0 ? (
        <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2">
          {result.matches}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground">{t('tool.fileRead.noMatch')}</p>
      )}
    </div>
  );
}

/**
 * 内容搜索渲染器 — 展示 grep 工具的匹配结果。
 */
export const GrepRenderer: ToolCallMessagePartComponent<GrepArgs, GrepResult> = ({
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
  // 标题行补充信息：展示正则模式，带搜索路径时一并展示
  const subtitle = args?.path ? `${args.pattern} · ${args.path}` : args?.pattern;

  return (
    <ToolCard
      title={t('tool.fileRead.title.grep')}
      subtitle={subtitle}
      icon={Search}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      interrupt={interrupt}
      resume={resume}
      addResult={addResult}
      respondToApproval={respondToApproval}
    >
      {result && <GrepView result={result} />}
    </ToolCard>
  );
};
