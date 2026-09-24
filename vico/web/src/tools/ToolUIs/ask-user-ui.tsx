/**
 * 向用户澄清工具 UI — 展示 LLM 提出的问题，收集用户回答并回传。
 *
 * 状态机：
 * - requires-action → 渲染问题 + 候选项 + 文本输入框，提交时 respondToApproval({ approved: true, reason: answer })
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
  isError,
  approval,
  respondToApproval,
}) => {
  const {t} = useTranslation('assistant');
  // 用户正在编辑的回答文本（提交后由审批态接管渲染）
  const [answer, setAnswer] = useState('');
  // 防重复提交
  const [submitted, setSubmitted] = useState(false);

  const question = typeof args?.question === 'string' ? args.question : '';
  const options = Array.isArray(args?.options)
    ? args.options.filter((o): o is string => typeof o === 'string')
    : [];

  // 提交回答：仅在未提交且处于待审批时生效
  const submit = (value: string) => {
    if (submitted) return;
    const trimmed = value.trim();
    if (!trimmed || !respondToApproval) return;
    setSubmitted(true);
    respondToApproval({approved: true, reason: trimmed});
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

    // 已批准：优先展示服务端回传的 answer，回传前展示等待占位
    return (
      <div className="border rounded-lg p-4 my-2 bg-muted/30">
        <div className="flex items-center gap-2">
          <Check size={16} className="text-green-500" />
          <span className="text-sm font-medium">{t('tool.askUser.title')}</span>
        </div>
        {question && <p className="mt-1.5 text-xs text-muted-foreground">{question}</p>}
        {result?.answer ? (
          <p className="mt-2 text-sm">{t('tool.askUser.answer', {answer: result.answer})}</p>
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
        </div>

        {question && <p className="text-sm">{question}</p>}

        {options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => submit(option)}
                disabled={submitted}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-full border border-border bg-background',
                  'hover:bg-muted transition-colors disabled:opacity-50',
                )}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit(answer);
            }}
            placeholder={t('tool.askUser.placeholder')}
            disabled={submitted}
          />
          <Button
            size="sm"
            variant="default"
            onClick={() => submit(answer)}
            disabled={submitted || !answer.trim()}
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
