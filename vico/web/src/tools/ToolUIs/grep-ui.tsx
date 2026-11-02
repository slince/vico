/**
 * 内容搜索工具 UI — 渲染 grep 只读工具（正则搜索结果）。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {Search} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {GrepArgs, GrepResult} from '../grep.tool';

/** grep 结果视图 — 结构化匹配结果，按文件分组展示 */
function GrepView({result}: {result: GrepResult}) {
  const {t} = useTranslation('assistant');
  if (result.matches.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('tool.fileRead.noMatch')}</p>;
  }

  // 按 path 分组，保持首个出现顺序
  const byFile = new Map<string, GrepResult['matches']>();
  for (const match of result.matches) {
    const group = byFile.get(match.path);
    if (group) group.push(match);
    else byFile.set(match.path, [match]);
  }

  return (
    <div className="space-y-2">
      {[...byFile].map(([path, matches]) => (
        <div key={path} className="space-y-0.5">
          <p className="font-mono text-xs text-muted-foreground truncate">{path}</p>
          <pre className="text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2">
            {matches.map((m) => `Line ${m.lineNumber}: ${m.line}`).join('\n')}
          </pre>
        </div>
      ))}
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
