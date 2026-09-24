/**
 * 向用户澄清工具 UI — 展示 LLM 提出的问题，收集用户回答并回传。
 *
 * 交互模式由 args.multiple 决定：
 * - 单选（缺省）：候选项以单选方式呈现，另提供文本输入框自由填写（文本优先）
 * - 多选：候选项以多选方式呈现，可勾选多个
 *
 * 状态机：
 * - requires-action → 渲染问题 + 候选项 + 输入，提交时 respondToApproval({ approved: true, reason: JSON.stringify(answers) })
 * - approval.approved === false → 展示已拒绝
 * - complete 且有 result → 展示用户回答
 * - running → 等待回答占位
 */
import {useState} from 'react';
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {HelpCircle, Check, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {cn} from '@/lib/utils';
import type {AskUserArgs, AskUserResult} from '../ask-user.tool';

export const AskUserRenderer: ToolCallMessagePartComponent<AskUserArgs, AskUserResult> = ({
  status,
  args,
  result,
  approval,
  respondToApproval,
}) => {
  const {t} = useTranslation('assistant');
  // 已选中的候选项（单选至多 1 个，多选可多个）
  const [selected, setSelected] = useState<string[]>([]);
  // 自由文本回答（仅单选模式展示）
  const [text, setText] = useState('');
  // 防重复提交
  const [submitted, setSubmitted] = useState(false);

  const question = typeof args?.question === 'string' ? args.question : '';
  const options = Array.isArray(args?.options)
    ? args.options.filter((o): o is string => typeof o === 'string')
    : [];
  const multiple = args?.multiple === true;

  // 切换候选项选中态：单选互斥，多选叠加
  const toggleOption = (option: string) => {
    if (submitted) return;
    setSelected((prev) => {
      if (multiple) {
        return prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option];
      }
      return prev.includes(option) ? [] : [option];
    });
  };

  // 组装回答并提交：单选时自由文本优先，否则取选中项
  const submit = () => {
    if (submitted || !respondToApproval) return;
    const trimmed = text.trim();
    const answers = multiple ? selected : trimmed ? [trimmed] : selected;
    if (answers.length === 0) return;
    setSubmitted(true);
    respondToApproval({approved: true, reason: JSON.stringify(answers)});
  };

  // 审批已裁决（被拒绝 / 已批准且有结果）
  if (approval?.approved !== undefined || result !== undefined) {
    const isApproved = approval?.approved ?? true;

    if (!isApproved) {
      return (
        <div className="border border-destructive/30 rounded-lg p-4 my-2 bg-destructive/5">
          <div className="flex items-center gap-2">
            <X size={16} className="text-destructive" />
            <span className="text-sm text-destructive">{t('tool.askUser.rejected')}</span>
          </div>
          {question && (
            <p className="mt-1.5 text-xs text-muted-foreground">{question}</p>
          )}
        </div>
      );
    }

    // 已批准：优先展示服务端回传的 answers，回传前展示等待占位
    const answersText = result?.answers?.length ? result.answers.join('、') : '';
    return (
      <div className="border rounded-lg p-4 my-2 bg-muted/30">
        <div className="flex items-center gap-2">
          <Check size={16} className="text-green-500" />
          <span className="text-sm font-medium">{t('tool.askUser.title')}</span>
        </div>
        {question && <p className="mt-1.5 text-xs text-muted-foreground">{question}</p>}
        {answersText ? (
          <p className="mt-2 text-sm">{t('tool.askUser.answer', {answer: answersText})}</p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">{t('tool.askUser.waiting')}</p>
        )}
      </div>
    );
  }

  // 需要用户回答
  if (status.type === 'requires-action') {
    return (
      <div className="border rounded-lg p-4 my-2 bg-muted/30 space-y-3">
        <div className="flex items-center gap-2">
          <HelpCircle size={14} className="text-muted-foreground" />
          <span className="text-sm font-medium">{t('tool.askUser.title')}</span>
          <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
            {multiple ? t('tool.askUser.modeMultiple') : t('tool.askUser.modeSingle')}
          </span>
        </div>

        {question && <p className="text-sm">{question}</p>}

        {options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {options.map((option) => {
              const isSelected = selected.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggleOption(option)}
                  disabled={submitted}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded-full border transition-colors disabled:opacity-50',
                    isSelected
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background hover:bg-muted',
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        )}

        {!multiple && (
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder={t('tool.askUser.placeholder')}
            disabled={submitted}
          />
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={submit}
            disabled={submitted || (multiple ? selected.length === 0 : !text.trim() && selected.length === 0)}
          >
            {t('tool.askUser.submit')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (submitted) return;
              setSubmitted(true);
              respondToApproval?.({approved: false});
            }}
            disabled={submitted}
          >
            {t('tool.askUser.deny')}
          </Button>
        </div>
      </div>
    );
  }

  // 执行中（回答已提交，等待服务端返回结果）
  if (status.type === 'running') {
    return (
      <div className="border rounded-lg p-4 my-2 bg-muted/30 animate-pulse">
        <div className="flex items-center gap-2">
          <HelpCircle size={14} className="text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{t('tool.askUser.waiting')}</span>
        </div>
      </div>
    );
  }

  return null;
};
