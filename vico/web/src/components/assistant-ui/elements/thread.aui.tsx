"use client";

import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/elements/attachment.aui";
import {File} from "@/components/assistant-ui/elements/file";
import {ThreadFollowupSuggestions} from "@/components/assistant-ui/elements/follow-up-suggestions.aui";
import {Image} from "@/components/assistant-ui/elements/image";
import {MarkdownText} from "@/components/assistant-ui/elements/markdown-text";
import {MessageTokenUsage} from "@/components/assistant-ui/message-token-usage";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/elements/reasoning.aui";
import {ToolFallback} from "@/components/assistant-ui/elements/tool-fallback.aui";
import {TooltipIconButton} from "@/components/assistant-ui/elements/tooltip-icon-button";
import {Button} from "@/components/ui/button";
import {Skeleton} from "@/components/ui/skeleton";
import {cn} from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  type AssistantState,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  type FileMessagePartComponent,
  groupPartByType,
  type ImageMessagePartComponent,
  MessagePrimitive,
  SuggestionPrimitive,
  type TextMessagePartComponent,
  type ThreadMessage,
  ThreadPrimitive,
  type ToolCallMessagePartComponent,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  AudioLinesIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MicIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PhoneIcon,
  RefreshCwIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import {
  type ComponentType,
  createContext,
  type FC,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {useTranslation} from "react-i18next";
import {AssistantThinking} from "@/components/assistant-ui/assistant-thinking";
import {CompletedActivityGroup} from "@/components/assistant-ui/elements/message-run-activity";
import {AutoOpenToolGroup} from "@/components/assistant-ui/auto-open-tool-group";
import {AgentSelectorAction} from "@/components/assistant-ui/agent-selector-action";
import {ApprovalModeSelectorAction} from "@/components/assistant-ui/approval-mode-selector-action";
import {ComposerSlashCommands} from "@/components/assistant-ui/composer-slash-commands";
import {ContextDisplayAction} from "@/components/assistant-ui/context-display-action";
import {ModelSelectorAction} from "@/components/assistant-ui/model-selector-action";
import {WorkspaceSelectorAction} from "@/components/assistant-ui/workspace-selector-action";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; `ReasoningGroup` overrides how reasoning
 * part groups render.
 *
 * 工具调用 running / 审批 / 失败态在正文平铺渲染；推理与工具调用始终平铺，
 * 不再做消息级折叠（折叠只发生在 turn 维度）。`ToolFallback` / `ToolGroup` /
 * `TaskGroup` 三个槽位仅为向后兼容保留，默认渲染管线不再读取。
 */
export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined;
  Welcome?: ComponentType | undefined;
  ToolFallback?: ToolCallMessagePartComponent | undefined;
  ToolGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
  ReasoningGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
  TaskGroup?: ComponentType<{ group: ThreadGroupPart }> | undefined;
};

const messageGroupBy = groupPartByType({
  reasoning: ["group-chainOfThought", "group-reasoning"],
  // 工具调用不分组（作为独立 part 平铺渲染）；推理与工具始终平铺，不做消息级折叠
  "tool-call": [],
  "standalone-tool-call": [],
});

type ThreadGroupKey =
  | "group-chainOfThought"
  | "group-reasoning"
  | "group-tool"
  | "group-task";

const TASK_GROUP_PATH: readonly ThreadGroupKey[] = [
  "group-chainOfThought",
  "group-task",
];

const taskAwareGroupBy = (
  part: Parameters<typeof messageGroupBy>[0],
  context?: Parameters<typeof messageGroupBy>[1],
): readonly ThreadGroupKey[] => {
  const path = messageGroupBy(part, context);
  return part.type === "tool-call" &&
    part.messages !== undefined &&
    path.length > 0 &&
    !context?.toolUIs?.[part.toolName]?.length
    ? TASK_GROUP_PATH
    : path;
};

export type ThreadProps = {
  components?: ThreadComponents | undefined;
  autoFocus?: boolean | undefined;
};

const EMPTY_COMPONENTS: ThreadComponents = {};

const ThreadComponentsContext =
  createContext<ThreadComponents>(EMPTY_COMPONENTS);

/** 一条 assistant 消息在其所属 turn 里的渲染上下文 */
type TurnMessageContextValue = {
  /** turn 是否已完成（完成态才做 text / 非 text 拆分与折叠） */
  isComplete: boolean;
  /** 当前消息是否是 turn 的最后一条 assistant 消息 */
  isLast: boolean;
  /** 是否位于折叠区内（折叠区内隐藏 footer；last 消息据此切换 text / 非 text） */
  inCollapse: boolean;
};

const TurnMessageContext = createContext<TurnMessageContextValue>({
  isComplete: false,
  isLast: false,
  inCollapse: false,
});

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

// A switched thread that is still fetching its history: skeleton, not welcome.
const isHistoryLoadingView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  s.thread.isLoading &&
  !s.thread.isDisabled &&
  !s.threads.isLoading;

const ThreadHistorySkeleton: FC = () => {
  const {t} = useTranslation('assistant');

  return (
    <div
      data-slot="aui_thread-history-skeleton"
      role="status"
      className="animate-in fade-in fill-mode-both flex flex-col gap-y-6 [animation-delay:150ms] [animation-duration:200ms]"
    >
      <span className="sr-only">{t('message.loading')}</span>
      <Skeleton className="ml-auto h-9 w-2/5 rounded-xl motion-reduce:animate-none" />
      <div className="flex flex-col gap-y-2">
        <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-3/5 motion-reduce:animate-none" />
      </div>
      <Skeleton className="ml-auto h-9 w-1/3 rounded-xl motion-reduce:animate-none" />
      <div className="flex flex-col gap-y-2">
        <Skeleton className="h-4 w-10/12 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
      </div>
    </div>
  );
};

export const Thread: FC<ThreadProps> = ({
  components = EMPTY_COMPONENTS,
  autoFocus = true,
}) => {
  const isEmpty = useAuiState(isNewChatView);

  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadRoot isEmpty={isEmpty} autoFocus={autoFocus} />
    </ThreadComponentsContext.Provider>
  );
};

const ThreadRoot: FC<{ isEmpty: boolean; autoFocus: boolean }> = ({
  isEmpty,
  autoFocus,
}) => {
  const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext);

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ["--thread-max-width" as string]: "64rem",
        ["--composer-bg" as string]:
          "color-mix(in oklab, var(--color-muted) 30%, transparent)",
        ["--composer-radius" as string]: "1rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4",
            isEmpty && "justify-center",
          )}
        >
          <AuiIf condition={isNewChatView}>
            <Welcome />
          </AuiIf>
          <AuiIf condition={isHistoryLoadingView}>
            <ThreadHistorySkeleton />
          </AuiIf>

          <div
            data-slot="aui_message-group"
            className="mb-14 flex flex-col gap-y-6 empty:hidden"
          >
            <ThreadMessageList />
          </div>

          <ThreadPrimitive.ViewportFooter
            className={cn(
              "aui-thread-viewport-footer bg-background flex flex-col gap-4 overflow-visible pb-4 md:pb-6",
              !isEmpty &&
                "sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
            )}
          >
            <ThreadScrollToBottom />
            <ThreadFollowupSuggestions />
            <Composer autoFocus={autoFocus} />
            <AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
              <ThreadSuggestions />
            </AuiIf>
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

type VoiceRunPosition = "single" | "start" | "middle" | "end";

const useVoiceRunPosition = (): VoiceRunPosition =>
  useAuiState((s) => {
    const before =
      s.thread.messages[s.message.index - 1]?.metadata.modality === "voice";
    const after =
      s.thread.messages[s.message.index + 1]?.metadata.modality === "voice";
    if (before) return after ? "middle" : "end";
    return after ? "start" : "single";
  });

const SpokenText: TextMessagePartComponent = ({ text }) => (
  <p className="aui-spoken-message-text m-0">{text}</p>
);

const SpokenMessage: FC = () => {
  const {t} = useTranslation('assistant');
  const role = useAuiState((s) => s.message.role);
  const position = useVoiceRunPosition();
  const isSpeaking = useAuiState(
    (s) =>
      s.message.role === "assistant" && s.message.status?.type === "running",
  );
  const opensExchange = position === "start" || position === "single";

  return (
    <MessagePrimitive.Root
      data-slot="aui_spoken-message-root"
      data-role={role}
      data-voice-run={position}
      className={cn(
        "aui-spoken-message bg-muted/40 mx-2 px-3 py-1.5 [contain-intrinsic-size:auto_48px] [content-visibility:auto]",
        position === "single" && "rounded-xl py-2",
        position === "start" && "rounded-t-xl pt-2",
        position === "middle" && "-mt-6",
        position === "end" && "-mt-6 rounded-b-xl pb-2",
      )}
    >
      {opensExchange && (
        <div
          data-slot="aui_spoken-exchange-header"
          className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs"
        >
          <PhoneIcon className="size-3" aria-hidden />
          <span>{t('voice.conversation')}</span>
        </div>
      )}
      <div
        data-slot="aui_spoken-message-content"
        className="text-foreground flex items-start gap-2 text-sm leading-relaxed"
      >
        <span className="text-muted-foreground mt-1 shrink-0" aria-hidden>
          {role === "user" ? (
            <MicIcon className="size-3.5" />
          ) : (
            <AudioLinesIcon className="size-3.5" />
          )}
        </span>
        <span className="sr-only">
          {role === "user" ? t('voice.youSaid') : t('voice.assistantSaid')}
        </span>
        <div className="min-w-0 flex-1 wrap-break-word">
          <MessagePrimitive.Parts components={{ Text: SpokenText }} />
          {isSpeaking && (
            <span
              data-slot="aui_spoken-message-indicator"
              role="status"
              className="text-muted-foreground ms-1 animate-pulse font-sans"
              aria-label={t('voice.assistantSpeaking')}
            >
              ●
            </span>
          )}
        </div>
        <SpokenActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const SpokenActionBar: FC = () => {
  const {t} = useTranslation('assistant');

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="always"
      className="aui-spoken-action-bar text-muted-foreground flex shrink-0 gap-1"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip={t('message.copy')} className="size-6">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  const {t} = useTranslation('assistant');

  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip={t('thread.scrollToBottom')}
        variant="outline"
        className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  const {t} = useTranslation('assistant');

  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col px-2">
      <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
        {t('welcome.title')}
      </p>
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions flex w-full flex-col">
      <ThreadPrimitive.Suggestions>
        {() => <ThreadSuggestionItem />}
      </ThreadPrimitive.Suggestions>
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
      <SuggestionPrimitive.Trigger send asChild>
        <button
          type="button"
          className="aui-thread-welcome-suggestion group hover:bg-foreground/[0.03] focus-visible:ring-ring/50 flex w-full items-baseline gap-2.5 rounded-md px-2 py-2 text-start text-sm transition-colors outline-none focus-visible:ring-1 motion-reduce:transition-none"
        >
          <span
            aria-hidden
            className="text-muted-foreground/60 group-hover:text-foreground font-mono text-xs transition-colors motion-reduce:transition-none"
          >
            {">"}
          </span>
          <span className="min-w-0 flex-1 truncate">
            <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1 text-foreground" />{" "}
            <SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 text-muted-foreground empty:hidden" />
          </span>
        </button>
      </SuggestionPrimitive.Trigger>
    </div>
  );
};

const Composer: FC<{ autoFocus: boolean }> = ({ autoFocus }) => {
  const {t} = useTranslation('assistant');

  return (
    <ComposerPrimitive.TriggerPopoverRoot>
      <ComposerSlashCommands />
      <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
        <ComposerPrimitive.AttachmentDropzone asChild>
          <div
            data-slot="aui_composer-shell"
            className="border-foreground/10 focus-within:border-foreground/25 data-[dragging=true]:border-ring flex w-full cursor-text flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) transition-[border-color] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]"
          >
            <ComposerAttachments />
            <ComposerPrimitive.Input
              placeholder={t('composer.placeholder')}
              className="aui-composer-input caret-primary placeholder:text-muted-foreground/60 max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 outline-none"
              rows={1}
              autoFocus={autoFocus}
              enterKeyHint="send"
              aria-label={t('composer.inputLabel')}
            />
            <ComposerAction />
          </div>
        </ComposerPrimitive.AttachmentDropzone>
      </ComposerPrimitive.Root>
    </ComposerPrimitive.TriggerPopoverRoot>
  );
};

const ComposerAction: FC = () => {
  const {t} = useTranslation('assistant');

  // The stop control only cancels the send while no run it could stop is going.
  const isSending = useAuiState(
    (s) =>
      s.composer.submission !== undefined &&
      !(s.thread.isRunning && s.thread.capabilities.cancel),
  );

  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <AgentSelectorAction />
        <WorkspaceSelectorAction />
        <ModelSelectorAction />
        <ApprovalModeSelectorAction />
        <ContextDisplayAction />
        <ComposerAddAttachment />
      </div>
      <div className="flex items-center gap-1.5">
        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <AuiIf condition={(s) => s.composer.dictation == null}>
            <ComposerPrimitive.Dictate asChild>
              <TooltipIconButton
                tooltip={t('voice.input')}
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-dictate text-muted-foreground hover:text-foreground size-7 rounded-full"
                aria-label={t('thread.startVoice')}
              >
                <MicIcon className="aui-composer-dictate-icon size-4" />
              </TooltipIconButton>
            </ComposerPrimitive.Dictate>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <ComposerPrimitive.StopDictation asChild>
              <TooltipIconButton
                tooltip={t('voice.stopDictation')}
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-stop-dictation text-destructive size-7 rounded-full"
                aria-label={t('thread.stopVoice')}
              >
                <SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
              </TooltipIconButton>
            </ComposerPrimitive.StopDictation>
          </AuiIf>
        </AuiIf>
        <AuiIf
          condition={(s) =>
            !s.composer.canCancel ||
            (s.thread.voice !== undefined &&
              s.composer.submission === undefined)
          }
        >
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip={t('thread.sendMessage')}
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-send size-7 rounded-full"
              aria-label={t('thread.sendMessage')}
            >
              <ArrowUpIcon className="aui-composer-send-icon size-4" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf
          condition={(s) =>
            s.composer.canCancel &&
            (s.thread.voice === undefined ||
              s.composer.submission !== undefined)
          }
        >
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel size-7 rounded-full"
              aria-label={isSending ? t('composer.cancelSending') : t('thread.stopGenerating')}
            >
              <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  const {
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ToolGroup,
    ReasoningGroup,
    TaskGroup: TaskGroupComponent,
  } = useContext(ThreadComponentsContext);

  // 推理与工具始终平铺（消息级折叠已移除，折叠只发生在 turn 维度）
  const groupBy = TaskGroupComponent ? taskAwareGroupBy : messageGroupBy;

  // turn 渲染上下文：完成态折叠区内隐藏 footer，last 消息据此拆分 text / 非 text
  const { isComplete, isLast, inCollapse } = useContext(TurnMessageContext);

  // 折叠区内的消息隐藏 footer 与占位
  const footerHidden = inCollapse || !isComplete;

  const ACTION_BAR_PT = "pt-1.5";
  // Keep the action bar inside the contained root's paint box, then cancel its reserved space in flow.
  const ACTION_BAR_HEIGHT = `min-h-7.5 ${ACTION_BAR_PT}`;

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className={cn(
        "fade-in slide-in-from-bottom-1 animate-in relative duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto]",
        !footerHidden && "-mb-7.5 pb-7.5",
      )}
    >
      <div
        data-slot="aui_assistant-message-content"
        className="text-foreground px-2 leading-relaxed wrap-break-word"
      >
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part, children }) => {
            // 完成态最后一条消息拆两段：折叠区内只留非 text（活动），折叠区外只留 text（正文）
            if (isComplete && isLast) {
              if (inCollapse && part.type === "text") return null;
              if (!inCollapse && part.type !== "text") return null;
            }

            switch (part.type) {
              case "group-chainOfThought":
                return <div data-slot="aui_chain-of-thought">{children}</div>;
              case "group-task":
                return TaskGroupComponent ? (
                  <TaskGroupComponent group={part} />
                ) : null;
              case "group-tool":
                if (ToolGroup) {
                  return <ToolGroup group={part}>{children}</ToolGroup>;
                }
                return (
                  <AutoOpenToolGroup group={part}>{children}</AutoOpenToolGroup>
                );
              case "group-reasoning": {
                if (ReasoningGroup) {
                  return (
                    <ReasoningGroup group={part}>{children}</ReasoningGroup>
                  );
                }
                const running = part.status.type === "running";
                return (
                  <ReasoningRoot streaming={running}>
                    <ReasoningTrigger active={running} />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "text":
                return <MarkdownText />;
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return part.toolUI ?? <ToolFallbackComponent {...part} />;
              case "data":
                return part.dataRendererUI;
              case "file":
                return (
                  <div data-slot="aui_assistant-message-file" className="py-1">
                    <File {...part} />
                  </div>
                );
              case "image":
                return (
                  <div data-slot="aui_assistant-message-image" className="py-1">
                    <Image {...part} />
                  </div>
                );
              case "indicator":
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        {/* 运行中的活动指示（思考中 / 正在执行某工具 + 已用时）；非运行态内部自动返回 null */}
        <AssistantThinking className="mt-2" />
        <MessageError />
      </div>

      {!footerHidden && (
        <div
          data-slot="aui_assistant-message-footer"
          className={cn("ms-2 flex items-center", ACTION_BAR_HEIGHT)}
        >
          <BranchPicker />
          <AssistantActionBar />
        </div>
      )}
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  const {t} = useTranslation('assistant');

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex gap-1 duration-200"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip={t('message.copy')}>
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <AuiIf condition={(s) => s.thread.capabilities.feedback}>
        <ActionBarPrimitive.FeedbackPositive asChild>
          <TooltipIconButton
            tooltip={t('feedback.helpful')}
            className="data-[submitted=true]:bg-accent data-[submitted=true]:text-accent-foreground"
          >
            <ThumbsUpIcon />
          </TooltipIconButton>
        </ActionBarPrimitive.FeedbackPositive>
        <ActionBarPrimitive.FeedbackNegative asChild>
          <TooltipIconButton
            tooltip={t('feedback.notHelpful')}
            className="data-[submitted=true]:bg-accent data-[submitted=true]:text-accent-foreground"
          >
            <ThumbsDownIcon />
          </TooltipIconButton>
        </ActionBarPrimitive.FeedbackNegative>
      </AuiIf>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip={t('thread.refresh')}>
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <MessageTokenUsage />
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip={t('thread.more')}
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content bg-popover text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
              <DownloadIcon className="size-4" />
              {t('thread.export')}
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserFilePart: FileMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-file" className="py-1">
    <File {...part} />
  </div>
);

const UserImagePart: ImageMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-image" className="py-1">
    <Image {...part} />
  </div>
);

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-muted text-foreground rounded-(--composer-radius) px-4 py-2 wrap-break-word empty:hidden">
          <MessagePrimitive.Parts
            components={{ File: UserFilePart, Image: UserImagePart }}
          />
        </div>
        <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 -me-1 justify-end"
      />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  const {t} = useTranslation('assistant');

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip={t('thread.edit')} className="aui-user-action-edit">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  const {t} = useTranslation('assistant');

  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root border-foreground/10 focus-within:border-foreground/25 ms-auto flex w-full max-w-[85%] cursor-text flex-col rounded-(--composer-radius) border bg-(--composer-bg) transition-[border-color]">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" className="h-8 px-3">
              {t('thread.cancel')}
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" className="h-8 px-3">
              {t('thread.update')}
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  const {t} = useTranslation('assistant');

  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip={t('thread.branch.previous')}>
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip={t('thread.branch.next')}>
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

// ============================================================================
// Turn 维度渲染
//
// 一个 turn = 一次「用户 → 助手」往返（含审批/续跑产生的多条 assistant 消息）。
// 会话完成后，只把最后一条 assistant 消息的正文展示出来；此前所有 assistant
// 消息（以及最后一条消息自身的推理/工具活动）统一收进 turn 级「已完成」折叠块。
// ============================================================================

/** `Unstable_MessageById` 的消息渲染配置（按角色/编辑态分派组件） */
type MessageComponentsConfig =
  ThreadPrimitive.Unstable_MessageById.Props["components"];

/** 一个 turn 的分组结果 */
type TurnGroup = {
  /** 稳定 React key（以 turn 首条消息 id 定位） */
  key: string;
  /** 开启该 turn 的 user 消息（正常线程必然存在） */
  userMessage?: ThreadMessage;
  /** 该 turn 的 assistant 消息（按时间序） */
  assistantMessages: readonly ThreadMessage[];
};

/**
 * 把线程消息按 user 消息结构性切分为 turn。
 *
 * 一条 user 消息开启一个 turn，其后的 assistant 消息都属于该 turn。结构性切分
 * 对乐观 user 消息、无文本的纯工具步骤同样稳健。
 *
 * @param messages - 线程消息（按序）
 * @returns turn 分组列表
 */
function groupMessagesIntoTurns(
  messages: readonly ThreadMessage[],
): readonly TurnGroup[] {
  const turns: TurnGroup[] = [];
  let currentUser: ThreadMessage | undefined;
  let currentAssistants: ThreadMessage[] = [];

  const flush = () => {
    if (currentUser === undefined && currentAssistants.length === 0) return;
    const first = currentUser ?? currentAssistants[0];
    turns.push({
      key: `turn:${first.id}`,
      userMessage: currentUser,
      assistantMessages: currentAssistants,
    });
    currentUser = undefined;
    currentAssistants = [];
  };

  for (const message of messages) {
    if (message.role === "user") {
      flush();
      currentUser = message;
      currentAssistants = [];
    } else if (message.role === "assistant") {
      currentAssistants.push(message);
    }
    // system 消息不参与渲染
  }
  flush();

  return turns;
}

/**
 * 测量一个 turn 的流式生成时长（毫秒）。
 *
 * 以最后一条 assistant 消息的 running/requires-action → complete 为打点边界；
 * 历史 turn（从未 running）返回 undefined。须在 TurnView（跨 turn 生命周期持久）
 * 内调用。
 *
 * @param assistantMessages - turn 的 assistant 消息
 * @returns 生成时长（毫秒），历史 turn 为 undefined
 */
function useTurnStreamDuration(
  assistantMessages: readonly ThreadMessage[],
): number | undefined {
  const [elapsed, setElapsed] = useState<number | undefined>(undefined);
  const startRef = useRef<number | null>(null);

  const lastStatus =
    assistantMessages[assistantMessages.length - 1]?.status?.type;
  const isActive = lastStatus === "running" || lastStatus === "requires-action";

  // 首次进入运行态打点（起点精确且只记录一次）
  if (isActive && startRef.current === null) {
    startRef.current = Date.now();
  }

  // 完成时结算一次；历史消息（从未 running）保持 undefined
  useEffect(() => {
    if (lastStatus === "complete" && startRef.current !== null) {
      setElapsed(Date.now() - startRef.current);
      startRef.current = null;
    }
  }, [lastStatus]);

  return elapsed;
}

/**
 * user 消息分派：语音消息走 SpokenMessage，否则走常规 UserMessage。
 */
const ThreadUserMessage: FC = () => {
  const isSpoken = useAuiState((s) => s.message.metadata.modality === "voice");
  if (isSpoken) return <SpokenMessage />;
  return <UserMessage />;
};

/**
 * assistant 消息分派：语音消息走 SpokenMessage，否则走（可被覆盖的）AssistantMessage。
 */
const ThreadAssistantMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
    useContext(ThreadComponentsContext);
  const isSpoken = useAuiState((s) => s.message.metadata.modality === "voice");
  if (isSpoken) return <SpokenMessage />;
  return <AssistantMessageComponent />;
};

/** 完整消息渲染（user / 运行中的 assistant）——按角色分派 */
const MESSAGE_COMPONENTS: MessageComponentsConfig = {
  UserMessage: ThreadUserMessage,
  AssistantMessage: ThreadAssistantMessage,
  EditComposer,
};

/**
 * 单个 turn 的渲染：user 消息 + 中间 assistant 消息折叠块 + 最后一条消息。
 *
 * 完成后把最后一条 assistant 消息拆成两段：推理/工具等非 text 活动收进
 * CompletedActivityGroup 折叠块（与中间消息同区），text 正文在折叠区外单独平铺。
 * 运行中 / 等待审批 / 异常则所有 assistant 消息完整平铺，不做折叠。
 */
const TurnView: FC<{ turn: TurnGroup }> = ({ turn }) => {
  const last = turn.assistantMessages[turn.assistantMessages.length - 1];
  const isComplete = last?.status?.type === "complete";

  // turn 级流式时长：running → complete 结算（历史 turn 无时长）
  const duration = useTurnStreamDuration(turn.assistantMessages);
  const prevMessages = turn.assistantMessages.slice(0, -1);

  // 最后一条消息是否含非 text 活动（推理/工具等）：决定是否拆出 activity 段
  const lastHasActivity =
    last?.content.some((part) => part.type !== "text") ?? false;

  const showCollapse =
    isComplete && (prevMessages.length > 0 || lastHasActivity);

  // 折叠区要渲染的消息：最后一条含非 text 活动时连同它一起收进折叠区，否则只收中间消息
  const collapsedMessages = lastHasActivity ? turn.assistantMessages : prevMessages;

  return (
    <div data-slot="aui_turn" className="contents">
      {turn.userMessage && (
        <ThreadPrimitive.Unstable_MessageById
          messageId={turn.userMessage.id}
          components={MESSAGE_COMPONENTS}
        />
      )}

      {!isComplete ? (
        // 运行中 / 等待审批 / 异常：所有 assistant 消息完整平铺，不折叠
        <>
          {turn.assistantMessages.map((message) => (
            <ThreadPrimitive.Unstable_MessageById
              key={message.id}
              messageId={message.id}
              components={MESSAGE_COMPONENTS}
            />
          ))}
        </>
      ) : (
        <>
          {/* 折叠区：中间消息完整渲染 + 最后一条消息仅非 text 活动 */}
          {showCollapse && (
            <CompletedActivityGroup elapsed={duration}>
              {collapsedMessages.map((message) => (
                <TurnMessageContext.Provider
                  key={message.id}
                  value={{ isComplete, isLast: message === last, inCollapse: true }}
                >
                  <ThreadPrimitive.Unstable_MessageById
                    messageId={message.id}
                    components={MESSAGE_COMPONENTS}
                  />
                </TurnMessageContext.Provider>
              ))}
            </CompletedActivityGroup>
          )}

          {/* 折叠区外：最后一条消息仅 text 正文（footer 正常显示） */}
          {last && (
            <TurnMessageContext.Provider
              value={{ isComplete, isLast: true, inCollapse: false }}
            >
              <ThreadPrimitive.Unstable_MessageById
                messageId={last.id}
                components={MESSAGE_COMPONENTS}
              />
            </TurnMessageContext.Provider>
          )}
        </>
      )}
    </div>
  );
};

/**
 * 线程消息列表：把消息切分为 turn，逐个渲染 TurnView。
 */
const ThreadMessageList: FC = () => {
  const messages = useAuiState((s) => s.thread.messages);

  const turns = useMemo(() => groupMessagesIntoTurns(messages), [messages]);

  return (
    <>
      {turns.map((turn) => (
        <TurnView key={turn.key} turn={turn} />
      ))}
    </>
  );
};
