/**
 * 文件查找工具 UI — 渲染 glob 只读工具（匹配文件列表）。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {FileSearch} from 'lucide-react';
import {FileLink} from '@/components/assistant-ui/elements/file-link';
import {ToolCard} from './tool-card';
import type {GlobArgs, GlobResult} from '../glob.tool';

/** glob 结果视图 — 文件路径列表 */
function GlobView({result}: {result: GlobResult}) {
  return (
    <ul className="space-y-0.5">
      {result.files.map((file, i) => (
        <li key={i} className="text-xs">
          <FileLink path={file} className="min-w-0" />
        </li>
      ))}
    </ul>
  );
}

/**
 * 文件查找渲染器 — 展示 glob 工具的匹配文件列表。
 */
export const GlobRenderer: ToolCallMessagePartComponent<GlobArgs, GlobResult> = ({
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
      title={t('tool.fileRead.title.glob')}
      subtitle={args?.pattern}
      icon={FileSearch}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      interrupt={interrupt}
      resume={resume}
      addResult={addResult}
      respondToApproval={respondToApproval}
    >
      {result && <GlobView result={result} />}
    </ToolCard>
  );
};
