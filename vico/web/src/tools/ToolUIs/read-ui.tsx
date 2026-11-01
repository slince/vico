/**
 * 文件读取工具 UI — 渲染 read 只读工具。
 *
 * 按文件类型分支：text=按扩展名语法高亮，image=图片，binary=占位。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {useCopyToClipboard} from 'react-use';
import {Check, Copy, FileText} from 'lucide-react';
import {guessLanguage} from '@/components/file-explorer/codemirror-language';
import {FileLink} from '@/components/assistant-ui/elements/file-link';
import {SyntaxHighlighter} from '@/components/assistant-ui/elements/shiki-highlighter';
import {ToolCard} from './tool-card';
import type {ReadArgs, ReadResult} from '../read.tool';

/** 复制按钮 — 点击将文本写入剪贴板，成功后显示绿色对勾 */
function CopyButton({text, label}: {text: string; label: string}) {
  const [clipboard, copyToClipboard] = useCopyToClipboard();

  // 复制成功且复制值等于目标文本时，显示绿色对勾
  const copied = clipboard.value === text && clipboard.error == null;

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => copyToClipboard(text)}
      className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
    >
      {copied ? (
        <Check size={13} className="text-emerald-500" />
      ) : (
        <Copy size={13} />
      )}
    </button>
  );
}

/** read 结果视图 — 按文件类型分支渲染 */
function ReadView({result, args}: {result: ReadResult; args: ReadArgs}) {
  const {t} = useTranslation('assistant');
  // 仅按行读取（传了 offset）时展示起始行号，紧跟路径行右侧、复制按钮之前
  const startLine = args.offset;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <FileLink path={result.path} className="min-w-0 text-[11px]" />
        <div className="flex items-center gap-2 shrink-0">
          {startLine != null && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {t('tool.fileRead.startLine', {line: startLine})}
            </span>
          )}
          <CopyButton text={result.content} label={t('tool.fileRead.copy')} />
        </div>
      </div>
      {result.type === 'image' ? (
        <img
          src={result.content}
          alt={result.path}
          className="max-h-64 rounded border"
        />
      ) : result.type === 'binary' ? (
        <p className="text-xs text-muted-foreground">{result.content}</p>
      ) : (
        <SyntaxHighlighter
          code={result.content}
          language={guessLanguage(result.path)}
          trim={false}
          className="[&_pre]:border-0 [&_pre]:bg-transparent!"
        />
      )}
    </div>
  );
}

/**
 * 文件读取渲染器 — 展示 read 工具的文件内容。
 */
export const ReadRenderer: ToolCallMessagePartComponent<ReadArgs, ReadResult> = ({
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
      title={t('tool.fileRead.title.read')}
      subtitle={args?.path}
      icon={FileText}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      interrupt={interrupt}
      resume={resume}
      addResult={addResult}
      respondToApproval={respondToApproval}
    >
      {result && args && <ReadView result={result} args={args} />}
    </ToolCard>
  );
};
