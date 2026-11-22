"use client";

import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Skeleton} from "@/components/ui/skeleton";
import {cn} from "@/lib/utils";
import {usePersistedState} from "@/hooks/use-persisted-state";
import {useWorkspaceSelection} from "@/stores/workspace-selection";
import {
  AuiIf,
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDown,
  Folder,
  FolderTree,
  List,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  X,
} from "lucide-react";
import {
  type ComponentPropsWithoutRef,
  type FC,
  forwardRef,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {useTranslation} from "react-i18next";
import {useNavigate} from "react-router-dom";

/** 会话列表视图模式：list=按日期分组，workspace=按工作区分组 */
export type ThreadListViewMode = "list" | "workspace";

/** 会话列表头部 — 视图切换按钮 + 搜索按钮（搜索态整条变为输入框） */
const ThreadListHeader: FC<{
  viewMode: ThreadListViewMode;
  onToggleMode: () => void;
  searchOpen: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
}> = ({
  viewMode,
  onToggleMode,
  searchOpen,
  search,
  onSearchChange,
  onOpenSearch,
  onCloseSearch,
}) => {
  const { t } = useTranslation("assistant");

  // 搜索态：header 整条替换为搜索输入框 + 关闭按钮
  if (searchOpen) {
    return (
      <div data-slot="aui_thread-list-header" className="flex items-center gap-1 px-2 py-1">
        <Input
          autoFocus
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("threadList.search")}
          aria-label={t("threadList.search")}
          className="h-7 flex-1 text-sm"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onCloseSearch}
          aria-label={t("threadList.closeSearch")}
          title={t("threadList.closeSearch")}
          className="size-7 shrink-0"
        >
          <X size={14} />
        </Button>
      </div>
    );
  }

  return (
    <div data-slot="aui_thread-list-header" className="flex items-center gap-1 px-2.5 py-1">
      <span className="text-muted-foreground flex-1 min-w-0 truncate text-xs font-semibold">
        {t("threadList.title")}
      </span>
      {/* 视图切换：图标表示点击后切换到的模式 */}
      <button
        type="button"
        onClick={onToggleMode}
        aria-label={viewMode === "list" ? t("threadList.workspaceView") : t("threadList.listView")}
        title={viewMode === "list" ? t("threadList.workspaceView") : t("threadList.listView")}
        className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors"
      >
        {viewMode === "list" ? <FolderTree size={14} /> : <List size={14} />}
      </button>
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label={t("threadList.search")}
        title={t("threadList.search")}
        className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors"
      >
        <SearchIcon size={14} />
      </button>
    </div>
  );
};

/** 视图模式 localStorage key — 下次进入沿用上次选择 */
const VIEW_MODE_STORAGE_KEY = "thread_list_view_mode";

/** ThreadList 顶层组件 — 顶部视图切换/搜索 header + 会话列表（showNew 控制新建按钮，默认 true） */
export const ThreadList: FC<{ showNew?: boolean }> = ({ showNew = true }) => {
  // 视图模式持久化（裸字符串存储，与旧数据兼容），下次进入沿用上次选择
  const [viewMode, setViewMode] = usePersistedState<ThreadListViewMode>(
    VIEW_MODE_STORAGE_KEY,
    "list",
    {
      serialize: (value) => value,
      deserialize: (raw) => (raw === "workspace" ? "workspace" : "list"),
    },
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");

  return (
    <ThreadListRoot>
      <ThreadListHeader
        viewMode={viewMode}
        onToggleMode={() => setViewMode((mode) => (mode === "list" ? "workspace" : "list"))}
        searchOpen={searchOpen}
        search={search}
        onSearchChange={setSearch}
        onOpenSearch={() => setSearchOpen(true)}
        onCloseSearch={() => {
          setSearchOpen(false);
          setSearch("");
        }}
      />
      {showNew && <ThreadListNew />}
      <ThreadListItems viewMode={viewMode} searchQuery={searchOpen ? search : ""} />
      <ArchivedThreadList />
    </ThreadListRoot>
  );
};

export const ThreadListSearch = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<typeof Input>, "value" | "onChange"> & {
    value: string;
    onValueChange: (value: string) => void;
  }
>(({ className, value, onValueChange, ...props }, ref) => {
  const {t} = useTranslation("assistant");
  return (
    <div data-slot="aui_thread-list-search" className="relative px-0.5 py-1">
      <SearchIcon
        data-slot="aui_thread-list-search-icon"
        className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
      />
      <Input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-label={t("threadList.search")}
        placeholder={t("threadList.search")}
        className={cn("h-8 ps-8 text-sm", className)}
        {...props}
      />
    </div>
  );
});

ThreadListSearch.displayName = "ThreadListSearch";

export const ThreadListRoot: FC<
  ComponentPropsWithoutRef<typeof ThreadListPrimitive.Root>
> = ({ className, ...props }) => {
  return (
    <ThreadListPrimitive.Root
      data-slot="aui_thread-list-root"
      className={cn("flex flex-col gap-0.5", className)}
      {...props}
    />
  );
};

export const ThreadListItems: FC<
  ComponentPropsWithoutRef<"div"> & {
    searchQuery?: string;
    /** 分组视图：list=按日期，workspace=按工作区（默认 list） */
    viewMode?: ThreadListViewMode;
  }
> = ({ className, searchQuery = "", viewMode = "list", ...props }) => {
  return (
    <div
      data-slot="aui_thread-list-items"
      className={cn("flex flex-col gap-0.5", className)}
      {...props}
    >
      <AuiIf condition={(s) => s.threads.isLoading}>
        <ThreadListSkeleton />
      </AuiIf>
      <AuiIf condition={(s) => !s.threads.isLoading}>
        {viewMode === "workspace" ? (
          <WorkspaceThreadListGroups searchQuery={searchQuery} />
        ) : (
          <ThreadListItemGroups searchQuery={searchQuery} />
        )}
      </AuiIf>
    </div>
  );
};

const DAY_IN_MS = 86_400_000;

/** 返回日期分组对应的 i18n key（today/yesterday/earlier），渲染时再翻译 */
const dateGroupLabel = (
  date: Date | undefined,
  startOfToday: number,
): string => {
  if (!date || date.getTime() >= startOfToday) return "today";
  if (date.getTime() >= startOfToday - DAY_IN_MS) return "yesterday";
  return "earlier";
};

export type ThreadListGroup = { label: string; indices: number[] };

/**
 * Filters the thread list by title and buckets the matches by last activity
 * (today / yesterday / earlier i18n keys). `groups` is null when no thread
 * carries a date, in which case `filteredIndices` keeps the runtime order.
 */
export const useThreadListGroups = (searchQuery = "") => {
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const {t} = useTranslation("assistant");

  const query = searchQuery.trim().toLowerCase();
  // 未命名会话在搜索时按本地化默认标题匹配
  const newChatFallback = t("threadList.newChat");

  return useMemo(() => {
    const itemsById = new Map(threadItems.map((item) => [item.id, item]));
    const dates = threadIds.map((id) => itemsById.get(id)?.lastMessageAt);
    const filteredIndices = threadIds
      .map((id, index) => ({ id, index }))
      .filter(
        ({ id }) =>
          !query ||
          (itemsById.get(id)?.title || newChatFallback)
            .toLowerCase()
            .includes(query),
      )
      .map(({ index }) => index);
    if (!filteredIndices.some((index) => dates[index])) {
      return { threadIds, filteredIndices, groups: null };
    }

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const time = (index: number) =>
      dates[index]?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const sorted = [...filteredIndices].sort((a, b) => time(b) - time(a));

    const result: ThreadListGroup[] = [];
    for (const index of sorted) {
      const label = dateGroupLabel(dates[index], startOfToday);
      const lastGroup = result[result.length - 1];
      if (lastGroup?.label === label) {
        lastGroup.indices.push(index);
      } else {
        result.push({ label, indices: [index] });
      }
    }
    return { threadIds, filteredIndices, groups: result };
  }, [threadIds, threadItems, query, newChatFallback]);
};

export type WorkspaceThreadGroup = {
  /** 分组标题展示名（workspace 末段路径；无 workspace 为「未分组」） */
  label: string;
  /** 原始 workspace 值（undefined 表示未分组） */
  workspace: string | undefined;
  /** 该分组内命中搜索词的 thread 在 threadIds 中的索引 */
  indices: number[];
  /** 分组内会话总数（不受搜索过滤影响） */
  total: number;
};

/**
 * 按工作区分组线程：从 thread 的 custom.workspace 取工作区，无 workspace 的
 * 归入「未分组」。先按搜索词过滤标题，再按 workspace 分组（保持后端时间序）。
 */
export const useWorkspaceGroups = (searchQuery = "") => {
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const { t } = useTranslation("assistant");

  const query = searchQuery.trim().toLowerCase();

  return useMemo(() => {
    const itemsById = new Map(threadItems.map((item) => [item.id, item]));
    const fallback = t("threadList.newChat");

    // 过滤：按标题匹配（未命名会话回退到本地化默认标题）
    const matchesQuery = (id: string) => {
      if (!query) return true;
      const title = (itemsById.get(id)?.title || fallback).toLowerCase();
      return title.includes(query);
    };

    // 工作区提取：custom.workspace 去空白后须为非空字符串，否则归入未分组
    const workspaceOf = (index: number): string | undefined => {
      const raw = itemsById.get(threadIds[index])?.custom?.workspace;
      if (typeof raw !== "string") return undefined;
      const w = raw.trim();
      return w || undefined;
    };

    // 全量分桶（用于展示分组总会话数）
    const allByWorkspace = new Map<string | undefined, number[]>();
    const filteredIndices: number[] = [];
    for (let index = 0; index < threadIds.length; index++) {
      const w = workspaceOf(index);
      const bucket = allByWorkspace.get(w);
      if (bucket) bucket.push(index);
      else allByWorkspace.set(w, [index]);
      if (matchesQuery(threadIds[index])) filteredIndices.push(index);
    }

    // 按首次出现顺序分组（保持后端时间序）
    const byWorkspace = new Map<string | undefined, number[]>();
    for (const index of filteredIndices) {
      const w = workspaceOf(index);
      const bucket = byWorkspace.get(w);
      if (bucket) bucket.push(index);
      else byWorkspace.set(w, [index]);
    }

    const groups: WorkspaceThreadGroup[] = [...byWorkspace.entries()].map(
      ([workspace, indices]) => ({
        workspace,
        // 展示末段路径；无 workspace 用「未分组」
        label: workspace
          ? workspace.split(/[\\/]/).filter(Boolean).pop() || workspace
          : t("threadList.ungrouped"),
        indices,
        total: allByWorkspace.get(workspace)?.length ?? 0,
      }),
    );

    return {
      threadIds,
      filteredIndices,
      groups,
      // 全量工作区 key（未分组用空串），不受搜索过滤影响，用于清理过期折叠记录
      allKeys: [...allByWorkspace.keys()].map((w) => w ?? ""),
    };
  }, [threadIds, threadItems, query, t]);
};

const ThreadListItemGroups: FC<{ searchQuery?: string }> = ({
  searchQuery = "",
}) => {
  const { threadIds, filteredIndices, groups } =
    useThreadListGroups(searchQuery);
  const {t} = useTranslation("assistant");
  const query = searchQuery.trim();

  if (query && filteredIndices.length === 0) {
    return (
      <div
        data-slot="aui_thread-list-empty"
        className="text-muted-foreground px-2.5 py-4 text-sm"
      >
        {t("threadList.noResults")}
      </div>
    );
  }

  if (!groups) {
    return filteredIndices.map((index) => (
      <ThreadListPrimitive.ItemByIndex
        key={threadIds[index]}
        index={index}
        components={{ ThreadListItem }}
      />
    ));
  }

  return groups.map((group) => (
    <Fragment key={group.label}>
      <div
        data-slot="aui_thread-list-group-label"
        className="text-muted-foreground px-2.5 pt-3 pb-1 text-xs font-medium"
      >
        {t(`threadList.${group.label}`)}
      </div>
      {group.indices.map((index) => (
        <ThreadListPrimitive.ItemByIndex
          key={threadIds[index]}
          index={index}
          components={{ ThreadListItem }}
        />
      ))}
    </Fragment>
  ));
};

/** 工作区分组折叠状态 localStorage key — 下次进入沿用上次折叠选择 */
const WORKSPACE_COLLAPSED_STORAGE_KEY = "thread_list_workspace_collapsed";

/** 工作区分组列表 — 手风琴折叠，每组标题展示 workspace 名与会话数 */
const WorkspaceThreadListGroups: FC<{ searchQuery?: string }> = ({ searchQuery = "" }) => {
  const { threadIds, filteredIndices, groups, allKeys } = useWorkspaceGroups(searchQuery);
  const { t } = useTranslation("assistant");
  const navigate = useNavigate();
  const aui = useAui();
  const setWorkspace = useWorkspaceSelection((s) => s.setWorkspace);
  // 各分组折叠状态持久化（key 为 workspace 原文，未分组用空串）
  const [collapsed, setCollapsed] = usePersistedState<Record<string, boolean>>(
    WORKSPACE_COLLAPSED_STORAGE_KEY,
    {},
  );

  const searching = !!searchQuery.trim();

  // 清理已不存在分组的折叠记录，避免 localStorage 只增不减（基于全量工作区，不受搜索过滤影响）
  const knownKeys = useMemo(() => new Set(allKeys), [allKeys]);
  useEffect(() => {
    setCollapsed((prev) => {
      const next: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (knownKeys.has(k)) next[k] = v;
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [knownKeys, setCollapsed]);

  // 在该工作区下新建会话：预设 workspace 后显式切到新草稿线程，再导航到 /chat。
  // 只靠受控 threadId 变 undefined 触发切换并不可靠（例如当前已在无 id 的 /chat 上时受控值没变化，
  // 或者切换时机与 store 里的 newThreadId 冲突），会留下上一个会话的消息继续渲染。
  // 首消息时 workspace 随 modelContext 下发给服务端写入 thread.metadata。
  const handleCreate = async (workspace: string | undefined) => {
    setWorkspace(workspace ?? null);
    // 确保目标分组展开，新草稿立即可见
    setCollapsed((prev) => ({ ...prev, [workspace ?? ""]: false }));
    try {
      await aui.threads.switchToNewThread();
    } catch (e) {
      console.warn('[workspace] 切换到新会话失败', e);
    }
    navigate('/chat');
  };

  if (searching && filteredIndices.length === 0) {
    return (
      <div
        data-slot="aui_thread-list-empty"
        className="text-muted-foreground px-2.5 py-4 text-sm"
      >
        {t("threadList.noResults")}
      </div>
    );
  }

  return (
    <>
      {groups.map((group) => {
        const key = group.workspace ?? "";
        // 搜索态忽略折叠，保证命中会话全部可见
        const isCollapsed = !searching && collapsed[key] === true;
        return (
          <div key={key || "__ungrouped__"} data-slot="aui_thread-workspace-group" className="flex flex-col gap-0.5">
            {/* 整个 header 共享悬浮背景；count 与新建 + 图标悬浮后才显示 */}
            <div className="group flex w-full items-center gap-0.5 rounded-md px-2.5 py-1 hover:bg-muted transition-colors">
              <button
                type="button"
                onClick={() => setCollapsed((prev) => ({ ...prev, [key]: !isCollapsed }))}
                aria-expanded={!isCollapsed}
                title={group.workspace}
                className="text-muted-foreground group-hover:text-foreground flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-0.5 text-xs font-medium transition-colors"
              >
                {/* 默认展示 folder；悬浮切换为折叠方向箭头。两图标重叠在固定宽度网格内，避免切换时 title 位移 */}
                <span className="relative grid size-3.5 shrink-0 place-items-center">
                  <Folder
                    size={13}
                    className="col-start-1 row-start-1 transition-opacity duration-150 group-hover:opacity-0"
                  />
                  <ChevronDown
                    size={14}
                    className={cn(
                      "col-start-1 row-start-1 opacity-0 transition-all duration-150 group-hover:opacity-100",
                      isCollapsed ? "-rotate-90" : "rotate-0",
                    )}
                  />
                </span>
                <span className="flex-1 min-w-0 truncate text-left">{group.label}</span>
              </button>
              <span
                className="text-muted-foreground/70 text-[10px] opacity-0 transition-opacity group-hover:opacity-100 tabular-nums"
                title={t("threadList.groupCount", { count: group.total })}
                aria-label={t("threadList.groupCount", { count: group.total })}
              >
                {searching ? `${group.indices.length}/${group.total}` : group.total}
              </span>
              <button
                type="button"
                onClick={() => handleCreate(group.workspace)}
                aria-label={t("threadList.newInWorkspace")}
                title={t("threadList.newInWorkspace")}
                className="text-muted-foreground/60 hover:text-foreground shrink-0 cursor-pointer rounded-md p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <PlusIcon size={14} />
              </button>
            </div>
            {!isCollapsed && (
              // 会话项与 workspace 同宽（背景全宽），文字缩进交由 CSS 处理
              <div className="flex flex-col gap-0.5">
                {group.indices.map((index) => (
                  <ThreadListPrimitive.ItemByIndex
                    key={threadIds[index]}
                    index={index}
                    components={{ ThreadListItem }}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};

export const ThreadListNew = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof Button> & { labelClassName?: string }
>(({ className, labelClassName, children, ...props }, ref) => {
  const {t} = useTranslation("assistant");
  // 普通「新建对话」入口：清空工作区预设（从工作区 header 新建不经过此处）
  const setWorkspace = useWorkspaceSelection((s) => s.setWorkspace);
  return (
    <ThreadListPrimitive.New asChild>
      <Button
        ref={ref}
        variant="ghost"
        data-slot="aui_thread-list-new"
        onClick={() => setWorkspace(null)}
        className={cn(
          "hover:bg-muted data-active:bg-muted h-8 justify-start gap-2 rounded-md px-2.5 text-sm font-normal",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <PlusIcon
              data-slot="aui_thread-list-new-icon"
              className="size-4 shrink-0"
            />
            <span
              data-slot="aui_thread-list-new-label"
              className={cn("whitespace-nowrap", labelClassName)}
            >
              {t("threadList.newThread")}
            </span>
          </>
        )}
      </Button>
    </ThreadListPrimitive.New>
  );
});

ThreadListNew.displayName = "ThreadListNew";

const ThreadListSkeleton: FC = () => {
  const {t} = useTranslation("assistant");
  return (
    <div className="flex flex-col gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          role="status"
          aria-label={t("threadList.loading")}
          data-slot="aui_thread-list-skeleton-wrapper"
          className="flex h-8 items-center px-2.5"
        >
          <Skeleton
            data-slot="aui_thread-list-skeleton"
            className="h-3.5 w-full"
          />
        </div>
      ))}
    </div>
  );
};

export const ThreadListItem: FC = () => {
  const isRunning = useAuiState((s) => s.threadListItem.isRunning);
  const {t} = useTranslation("assistant");
  const [isRenaming, setIsRenaming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    if (isRenaming || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus();
  }, [isRenaming]);

  return (
    <ThreadListItemPrimitive.Root
      data-slot="aui_thread-list-item"
      className="group hover:bg-muted focus-visible:bg-muted data-active:bg-muted has-focus-visible:bg-muted has-data-[state=open]:bg-muted relative flex h-8 items-center rounded-md transition-colors focus-visible:outline-none"
    >
      {isRenaming ? (
        <ThreadListItemRename
          onDone={(restoreFocus) => {
            restoreFocusRef.current = restoreFocus;
            setIsRenaming(false);
          }}
        />
      ) : (
        <ThreadListItemPrimitive.Trigger
          ref={triggerRef}
          data-slot="aui_thread-list-item-trigger"
          className="focus-visible:ring-ring/50 flex h-full min-w-0 flex-1 cursor-pointer items-center rounded-md px-2.5 text-start text-sm outline-none group-hover:pe-9 group-has-focus-visible:pe-9 group-has-data-[state=open]:pe-9 group-data-active:pe-9 focus-visible:ring-1"
        >
          {isRunning && (
            <Loader2Icon
              aria-hidden
              data-slot="aui_thread-list-item-running"
              className="text-muted-foreground me-1.5 size-3.5 shrink-0 animate-spin"
            />
          )}
          <span
            data-slot="aui_thread-list-item-title"
            className="min-w-0 flex-1 truncate"
          >
            <ThreadListItemPrimitive.Title fallback={t("threadList.newChat")} />
          </span>
          {isRunning && <span className="sr-only">{t("threadList.running")}</span>}
        </ThreadListItemPrimitive.Trigger>
      )}
      <ThreadListItemMore onRename={() => setIsRenaming(true)} />
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemRename: FC<{
  onDone: (restoreFocus: boolean) => void;
}> = ({ onDone }) => {
  const aui = useAui();
  const title = useAuiState((s) => s.threadListItem.title) ?? "";
  const {t} = useTranslation("assistant");
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const commit = (restoreFocus: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;

    const next = value.trim();
    if (!next || next === title) {
      onDone(restoreFocus);
      return;
    }

    // Deferred so a synchronous throw lands on the rejection path too.
    Promise.resolve()
      .then(() => aui.threadListItem.rename(next))
      .then(
        () => onDone(restoreFocus),
        () => {
          settledRef.current = false;
          if (restoreFocus) inputRef.current?.focus();
        },
      );
  };

  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onDone(true);
  };

  return (
    <Input
      ref={inputRef}
      autoFocus
      data-slot="aui_thread-list-item-rename"
      aria-label={t("threadList.rename")}
      value={value}
      className="h-7 min-w-0 flex-1 ps-2.5 pe-9 text-sm"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => commit(false)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );
};

/** 更多菜单普通项样式 */
const MORE_ITEM_CLASS =
  "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none";

/** 更多菜单危险项（删除）样式 */
const MORE_ITEM_DESTRUCTIVE_CLASS =
  "text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none";

const ThreadListItemMore: FC<{ onRename: () => void }> = ({ onRename }) => {
  // 归档会话不提供重命名 / 归档，改为「取消归档」
  const isArchived = useAuiState((s) => s.threadListItem.status === "archived");
  const {t} = useTranslation("assistant");

  return (
    <ThreadListItemMorePrimitive.Root sharedFocusGroup>
      <ThreadListItemMorePrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-slot="aui_thread-list-item-more"
          className="data-[state=open]:bg-accent absolute end-1.5 top-1/2 size-6 -translate-y-1/2 cursor-pointer p-0 opacity-0 group-hover:opacity-100 group-has-focus-visible:opacity-100 group-data-active:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontalIcon className="size-3.5" />
          <span className="sr-only">{t("threadList.moreOptions")}</span>
        </Button>
      </ThreadListItemMorePrimitive.Trigger>
      <ThreadListItemMorePrimitive.Content
        side="right"
        align="start"
        sideOffset={6}
        data-slot="aui_thread-list-item-more-content"
        className="bg-popover text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-32 overflow-hidden rounded-xl border p-1.5"
      >
        {!isArchived && (
          <ThreadListItemMorePrimitive.Item
            data-slot="aui_thread-list-item-more-item"
            className={MORE_ITEM_CLASS}
            onSelect={onRename}
          >
            <PencilIcon className="size-4" />
            {t("threadList.rename")}
          </ThreadListItemMorePrimitive.Item>
        )}
        {isArchived ? (
          <ThreadListItemPrimitive.Unarchive asChild>
            <ThreadListItemMorePrimitive.Item
              data-slot="aui_thread-list-item-more-item"
              className={MORE_ITEM_CLASS}
            >
              <ArchiveRestoreIcon className="size-4" />
              {t("threadList.unarchive")}
            </ThreadListItemMorePrimitive.Item>
          </ThreadListItemPrimitive.Unarchive>
        ) : (
          <ThreadListItemPrimitive.Archive asChild>
            <ThreadListItemMorePrimitive.Item
              data-slot="aui_thread-list-item-more-item"
              className={MORE_ITEM_CLASS}
            >
              <ArchiveIcon className="size-4" />
              {t("threadList.archive")}
            </ThreadListItemMorePrimitive.Item>
          </ThreadListItemPrimitive.Archive>
        )}
        <ThreadListItemPrimitive.Delete asChild>
          <ThreadListItemMorePrimitive.Item
            data-slot="aui_thread-list-item-more-item"
            className={MORE_ITEM_DESTRUCTIVE_CLASS}
          >
            <TrashIcon className="size-4" />
            {t("threadList.delete")}
          </ThreadListItemMorePrimitive.Item>
        </ThreadListItemPrimitive.Delete>
      </ThreadListItemMorePrimitive.Content>
    </ThreadListItemMorePrimitive.Root>
  );
};

/** 归档会话分区 — 仅在有归档会话时展示，点击条目切换时 assistant-ui 会自动取消归档 */
const ArchivedThreadList: FC = () => {
  const archivedThreadIds = useAuiState((s) => s.threads.archivedThreadIds);
  const {t} = useTranslation("assistant");
  if (archivedThreadIds.length === 0) return null;

  return (
    <div
      data-slot="aui_thread-list-archived"
      className="mt-2 border-t pt-1"
    >
      <div className="text-muted-foreground px-2.5 pt-1 pb-1 text-xs font-medium">
        {t("threadList.archived")}
      </div>
      {archivedThreadIds.map((id, index) => (
        <ThreadListPrimitive.ItemByIndex
          key={id}
          index={index}
          archived
          components={{ ThreadListItem }}
        />
      ))}
    </div>
  );
};
