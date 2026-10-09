/**
 * 文件浏览器 Zustand Store。
 *
 * 管理右侧面板的顶层 tab 模型：文件树（可关闭）、已打开的文件（含内容缓存）、
 * 终端（多个，按 terminalId 区分），以及当前活跃 tab 与面板开关。
 * 文件树目录缓存放在 FileExplorer 组件内部，避免 store 膨胀。
 */
import { create } from 'zustand';

export interface OpenFileTab {
  threadId: string;
  filePath: string;
  fileName: string;
  content?: string;
  isLoading: boolean;
  error?: string;
}

/** 面板顶层 tab：文件树 / 打开的文件 / 终端 */
export type PanelTab =
  | { kind: 'files' }
  | { kind: 'file'; filePath: string }
  | { kind: 'terminal'; terminalId: string };

/** 判断两个 tab 是否为同一个（按 kind + 标识符） */
export function sameTab(a: PanelTab | null | undefined, b: PanelTab): boolean {
  if (!a) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'file' && b.kind === 'file') return a.filePath === b.filePath;
  if (a.kind === 'terminal' && b.kind === 'terminal') return a.terminalId === b.terminalId;
  return true; // 均为 'files'
}

interface FileExplorerState {
  /** 右侧文件浏览器面板开关 */
  fileExplorerOpen: boolean;
  /** 每个 thread 的文件树 tab 是否打开（默认 true，即未显式关闭时视为打开） */
  filesOpenByThread: Record<string, boolean>;
  /** 每个 thread 的已打开文件 tabs */
  openTabsByThread: Record<string, OpenFileTab[]>;
  /** 每个 thread 的终端 tab id 列表（有序） */
  terminalTabsByThread: Record<string, string[]>;
  /** 每个 thread 的当前活跃 tab；null 表示无任何 tab */
  activeTabByThread: Record<string, PanelTab | null>;

  // actions
  openFile: (threadId: string, filePath: string, fileName: string) => void;
  setActiveTab: (threadId: string, tab: PanelTab) => void;
  closeTab: (threadId: string, tab: PanelTab) => void;
  closeTabsToLeft: (threadId: string, tab: PanelTab) => void;
  closeTabsToRight: (threadId: string, tab: PanelTab) => void;
  closeAllTabs: (threadId: string) => void;
  createTerminal: (threadId: string) => void;
  openFilesTab: (threadId: string) => void;
  setFileContent: (threadId: string, filePath: string, content: string) => void;
  setFileLoading: (threadId: string, filePath: string, loading: boolean) => void;
  setFileError: (threadId: string, filePath: string, error: string) => void;
  toggleFileExplorer: () => void;
}

/** 计算某线程当前有序的顶层 tab 列表：[文件树?] + [文件...] + [终端...] */
function orderedTabs(state: FileExplorerState, threadId: string): PanelTab[] {
  const tabs: PanelTab[] = [];
  if (state.filesOpenByThread[threadId] !== false) tabs.push({ kind: 'files' });
  for (const f of state.openTabsByThread[threadId] ?? []) {
    tabs.push({ kind: 'file', filePath: f.filePath });
  }
  for (const id of state.terminalTabsByThread[threadId] ?? []) {
    tabs.push({ kind: 'terminal', terminalId: id });
  }
  return tabs;
}

/** 依据保留的 tab 集合重建三类 tab 状态，并修正活跃 tab */
function rebuildTabs(
  state: FileExplorerState,
  threadId: string,
  keep: PanelTab[],
): Pick<
  FileExplorerState,
  'filesOpenByThread' | 'openTabsByThread' | 'terminalTabsByThread' | 'activeTabByThread'
> {
  const keepFiles = keep.some((t) => t.kind === 'files');
  const keepFilePaths = new Set(
    keep.filter((t) => t.kind === 'file').map((t) => (t as { filePath: string }).filePath),
  );
  const keepTerminalIds = new Set(
    keep.filter((t) => t.kind === 'terminal').map((t) => (t as { terminalId: string }).terminalId),
  );

  const openTabs = (state.openTabsByThread[threadId] ?? []).filter((f) =>
    keepFilePaths.has(f.filePath),
  );
  const terminals = (state.terminalTabsByThread[threadId] ?? []).filter((id) =>
    keepTerminalIds.has(id),
  );

  // 活跃 tab 若被关闭，则回退到最后一个保留的 tab（或无）
  let active = state.activeTabByThread[threadId] ?? null;
  if (active && !keep.some((t) => sameTab(t, active as PanelTab))) {
    active = keep.length > 0 ? keep[keep.length - 1] : null;
  }

  return {
    filesOpenByThread: { ...state.filesOpenByThread, [threadId]: keepFiles },
    openTabsByThread: { ...state.openTabsByThread, [threadId]: openTabs },
    terminalTabsByThread: { ...state.terminalTabsByThread, [threadId]: terminals },
    activeTabByThread: { ...state.activeTabByThread, [threadId]: active },
  };
}

export const useFileExplorerStore = create<FileExplorerState>((set, get) => ({
  openTabsByThread: {},
  filesOpenByThread: {},
  terminalTabsByThread: {},
  activeTabByThread: {},
  fileExplorerOpen: false,

  /** 打开文件：已在 tabs 中则激活它；否则创建新 tab 并异步拉取内容 */
  openFile: (threadId, filePath, fileName) => {
    set((state) => {
      const threadTabs = state.openTabsByThread[threadId] ?? [];
      const exists = threadTabs.find((t) => t.filePath === filePath);
      if (exists) {
        return {
          activeTabByThread: { ...state.activeTabByThread, [threadId]: { kind: 'file', filePath } },
        };
      }
      const newTab: OpenFileTab = { threadId, filePath, fileName, isLoading: true };
      return {
        openTabsByThread: {
          ...state.openTabsByThread,
          [threadId]: [...threadTabs, newTab],
        },
        activeTabByThread: {
          ...state.activeTabByThread,
          [threadId]: { kind: 'file', filePath },
        },
      };
    });

    // 异步拉取文件内容
    fetch(
      `/api/v1/threads/${threadId}/fs/read?path=${encodeURIComponent(filePath)}`,
      { credentials: 'include' },
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        get().setFileContent(threadId, filePath, data.content);
      })
      .catch((err) => {
        get().setFileError(threadId, filePath, err.message);
      });
  },

  /** 激活指定 tab */
  setActiveTab: (threadId, tab) => {
    set((state) => ({
      activeTabByThread: { ...state.activeTabByThread, [threadId]: tab },
    }));
  },

  /** 关闭指定 tab（文件树 / 文件 / 终端） */
  closeTab: (threadId, tab) => {
    set((state) => {
      const keep = orderedTabs(state, threadId).filter((t) => !sameTab(t, tab));
      return rebuildTabs(state, threadId, keep);
    });
  },

  /** 关闭指定 tab 左侧的所有 tab（含该 tab 左侧的文件树/文件/终端） */
  closeTabsToLeft: (threadId, tab) => {
    set((state) => {
      const tabs = orderedTabs(state, threadId);
      const idx = tabs.findIndex((t) => sameTab(t, tab));
      if (idx === -1) return state;
      return rebuildTabs(state, threadId, tabs.slice(idx));
    });
  },

  /** 关闭指定 tab 右侧的所有 tab */
  closeTabsToRight: (threadId, tab) => {
    set((state) => {
      const tabs = orderedTabs(state, threadId);
      const idx = tabs.findIndex((t) => sameTab(t, tab));
      if (idx === -1) return state;
      return rebuildTabs(state, threadId, tabs.slice(0, idx + 1));
    });
  },

  /** 关闭所有 tab（文件树 + 全部文件 + 全部终端） */
  closeAllTabs: (threadId) => {
    set((state) => rebuildTabs(state, threadId, []));
  },

  /** 新建终端 tab 并激活 */
  createTerminal: (threadId) => {
    const terminalId = crypto.randomUUID();
    set((state) => ({
      terminalTabsByThread: {
        ...state.terminalTabsByThread,
        [threadId]: [...(state.terminalTabsByThread[threadId] ?? []), terminalId],
      },
      activeTabByThread: {
        ...state.activeTabByThread,
        [threadId]: { kind: 'terminal', terminalId },
      },
    }));
  },

  /** 打开（或重新打开）文件树 tab 并激活 */
  openFilesTab: (threadId) => {
    set((state) => ({
      filesOpenByThread: { ...state.filesOpenByThread, [threadId]: true },
      activeTabByThread: { ...state.activeTabByThread, [threadId]: { kind: 'files' } },
    }));
  },

  setFileContent: (threadId, filePath, content) => {
    set((state) => {
      const threadTabs = (state.openTabsByThread[threadId] ?? []).map((t) =>
        t.filePath === filePath ? { ...t, content, isLoading: false, error: undefined } : t,
      );
      return {
        openTabsByThread: { ...state.openTabsByThread, [threadId]: threadTabs },
      };
    });
  },

  setFileLoading: (threadId, filePath, loading) => {
    set((state) => {
      const threadTabs = (state.openTabsByThread[threadId] ?? []).map((t) =>
        t.filePath === filePath ? { ...t, isLoading: loading } : t,
      );
      return {
        openTabsByThread: { ...state.openTabsByThread, [threadId]: threadTabs },
      };
    });
  },

  setFileError: (threadId, filePath, error) => {
    set((state) => {
      const threadTabs = (state.openTabsByThread[threadId] ?? []).map((t) =>
        t.filePath === filePath ? { ...t, isLoading: false, error } : t,
      );
      return {
        openTabsByThread: { ...state.openTabsByThread, [threadId]: threadTabs },
      };
    });
  },

  toggleFileExplorer: () => {
    set((state) => ({ fileExplorerOpen: !state.fileExplorerOpen }));
  },
}));
