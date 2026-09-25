/**
 * 向用户澄清工具 UI — 展示 LLM 提出的问题列表，收集用户回答并回传。
 *
 * 支持一次回答多个问题（args.questions）；每个问题独立单选/多选（multiSelect）
 * 并可自由填写文本。语义约定：
 * - 单选：自由文本 custom 覆盖所选候选项
 * - 多选：自由文本 custom 补充所选候选项
 *
 * 状态机：
 * - requires-action → 渲染问题列表 + 候选项 + 文本输入，提交时
 *   respondToApproval({ approved: true, reason: JSON.stringify({answers}) })
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

/** 单个问题的编辑状态 */
interface QuestionState {
  selected: string[];
  custom: string;
}

/** 单个问题的问题字段 */
interface QuestionFieldProps {
  question: AskUserArgs['questions'][number];
  state: QuestionState;
  disabled: boolean;
  onToggle: (label: string) => void;
  onCustom: (value: string) => void;
}

/** 渲染单个问题：标题、问题、补充说明、候选项、自由文本输入 */
function QuestionField({question, state, disabled, onToggle, onCustom}: QuestionFieldProps) {
  const {t} = useTranslation('assistant');
  const multiSelect = question.multiSelect === true;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {question.header && <span className="text-xs font-semibold">{question.header}</span>}
        <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
          {multiSelect ? t('tool.askUser.modeMultiple') : t('tool.askUser.modeSingle')}
        </span>
      </div>

      <p className="text-sm">{question.question}</p>
      {question.detail && <p className="text-xs text-muted-foreground">{question.detail}</p>}

      {question.options && question.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {question.options.map((option) => {
            const isSelected = state.selected.includes(option.label);
            return (
              <button
                key={option.label}
                type="button"
                title={option.description}
                onClick={() => onToggle(option.label)}
                disabled={disabled}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-full border transition-colors disabled:opacity-50',
                  isSelected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background hover:bg-muted',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}

      <Input
        value={state.custom}
        onChange={(e) => onCustom(e.target.value)}
        placeholder={t('tool.askUser.customPlaceholder')}
        disabled={disabled}
      />
    </div>
  );
}

export const AskUserRenderer: ToolCallMessagePartComponent<AskUserArgs, AskUserResult> = ({
  status,
  args,
  result,
  approval,
  respondToApproval,
}) => {
  const {t} = useTranslation('assistant');
  const questions = Array.isArray(args?.questions) ? args.questions : [];
  // 各问题编辑状态，key 为问题 id
  const [state, setState] = useState<Record<string, QuestionState>>({});
  // 防重复提交
  const [submitted, setSubmitted] = useState(false);

  const getState = (id: string): QuestionState => state[id] ?? {selected: [], custom: ''};

  // 切换候选项选中态：单选互斥，多选叠加
  const toggleOption = (id: string, multiSelect: boolean, label: string) => {
    if (submitted) return;
    setState((prev) => {
      const cur = prev[id] ?? {selected: [], custom: ''};
      const selected = multiSelect
        ? (cur.selected.includes(label) ? cur.selected.filter((o) => o !== label) : [...cur.selected, label])
        : (cur.selected.includes(label) ? [] : [label]);
      return {...prev, [id]: {...cur, selected}};
    });
  };

  const setCustom = (id: string, custom: string) => {
    if (submitted) return;
    setState((prev) => ({...prev, [id]: {...getState(id), custom}}));
  };

  // 组装结构化答案：单选时 custom 覆盖 selected，多选时 custom 补充
  const buildAnswers = () =>
    questions.map((q) => {
      const st = getState(q.id);
      const custom = st.custom.trim();
      if (q.multiSelect !== true && custom) {
        return {id: q.id, selected: [], custom};
      }
      return {id: q.id, selected: st.selected, ...(custom ? {custom} : {})};
    });

  const submit = () => {
    if (submitted || !respondToApproval) return;
    const answers = buildAnswers();
    if (!answers.some((a) => a.selected.length > 0 || a.custom)) return;
    setSubmitted(true);
    respondToApproval({approved: true, reason: JSON.stringify({answers})});
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
        </div>
      );
    }

    // 已批准：展示服务端回传的 answers，回传前展示等待占位
    const answersText = result?.answers
      ?.map((a) => a.custom || a.selected.join('、'))
      .filter(Boolean)
      .join('；');
    return (
      <div className="border rounded-lg p-4 my-2 bg-muted/30">
        <div className="flex items-center gap-2">
          <Check size={16} className="text-green-500" />
          <span className="text-sm font-medium">{t('tool.askUser.title')}</span>
        </div>
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
      <div className="border rounded-lg p-4 my-2 bg-muted/30 space-y-4">
        <div className="flex items-center gap-2">
          <HelpCircle size={14} className="text-muted-foreground" />
          <span className="text-sm font-medium">{t('tool.askUser.title')}</span>
        </div>

        {questions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            state={getState(q.id)}
            disabled={submitted}
            onToggle={(label) => toggleOption(q.id, q.multiSelect === true, label)}
            onCustom={(value) => setCustom(q.id, value)}
          />
        ))}

        <div className="flex gap-2">
          <Button size="sm" variant="default" onClick={submit} disabled={submitted}>
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
