/**
 * 文件写入工具 UI — 渲染 write 变更类工具（需审批）。
 *
 *   write → action（created/updated）+ path + lines + size
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {FilePlus} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {WriteArgs, WriteResult} from '../write.tool';

/** write 结果视图 */
function WriteView({result}: {result: WriteResult}) {
  const {t} = useTranslation('assistant');
  const actionText = result.action === 'created' ? t('tool.fileWrite.created') : t('tool.fileWrite.updated');
  return (
    <div className="space-y-1 text-xs">
      <p className="font-mono text-muted-foreground">{result.path}</p>
      <p className="text-muted-foreground">
        {actionText} · {t('tool.fileWrite.lines', {n: result.lines})} · {t('tool.fileWrite.bytes', {n: result.size})}
      </p>
    </div>
  );
}

/**
 * 文件写入渲染器 — 展示 write 工具的结果（需审批）。
 */
export const WriteRenderer: ToolCallMessagePartComponent<WriteArgs, WriteResult> = ({
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
      title={t('tool.fileWrite.title.write')}
      subtitle={args?.path}
      icon={FilePlus}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      interrupt={interrupt}
      resume={resume}
      addResult={addResult}
      respondToApproval={respondToApproval}
    >
      {result && <WriteView result={result} />}
    </ToolCard>
  );
};
