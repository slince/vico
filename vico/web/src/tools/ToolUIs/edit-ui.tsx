/**
 * 文件编辑工具 UI — 渲染 edit 变更类工具（需审批）。
 *
 *   edit → path + replacements + diff（行级着色）
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {FilePen} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {EditArgs, EditResult} from '../edit.tool';

/** edit 的 simple diff（+/- 行）着色 */
function DiffLines({diff}: {diff: string}) {
  return (
    <pre className="text-[11px] leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-all bg-background/50 rounded p-2">
      {diff.split('\n').map((line, i) => {
        let cls = 'text-muted-foreground';
        if (line.startsWith('+')) cls = 'text-green-600 dark:text-green-400';
        else if (line.startsWith('-')) cls = 'text-red-600 dark:text-red-400';
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

/** edit 结果视图 */
function EditView({result}: {result: EditResult}) {
  const {t} = useTranslation('assistant');
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[11px] text-muted-foreground">{result.path}</p>
      {result.replacements > 0 && (
        <p className="text-xs text-muted-foreground">{t('tool.fileWrite.replacements', {n: result.replacements})}</p>
      )}
      <DiffLines diff={result.diff} />
    </div>
  );
}

/**
 * 文件编辑渲染器 — 展示 edit 工具的替换结果与 unified diff（需审批）。
 */
export const EditRenderer: ToolCallMessagePartComponent<EditArgs, EditResult> = ({
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
      title={t('tool.fileWrite.title.edit')}
      subtitle={args?.path}
      icon={FilePen}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      interrupt={interrupt}
      resume={resume}
      addResult={addResult}
      respondToApproval={respondToApproval}
    >
      {result && <EditView result={result} />}
    </ToolCard>
  );
};
