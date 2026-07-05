/**
 * 文件浏览器 Zustand Store。
 *
 * 管理跨组件的状态：open tabs、active tab、右侧面板开关。
 * 文件树缓存（目录条目）放在 FileExplorerPanel 组件内部，避免 store 膨胀。
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

interface FileExplorerState {
  /** 每个 thread 的已打开文件 tabs */
  openTabsByThread: Record<string, OpenFileTab[]>;
  /** 每个 thread 的当前活跃 tab（文件路径）；null 表示没有活跃文件 tab */
  activeTabByThread: Record<string, string | null>;
  /** 右侧文件浏览器面板开关 */
  fileExplorerOpen: boolean;

  // actions
  openFile: (threadId: string, filePath: string, fileName: string) => void;
  closeTab: (threadId: string, filePath: string) => void;
  setActiveTab: (threadId: string, filePath: string | null) => void;
  setFileContent: (threadId: string, filePath: string, content: string) => void;
  setFileLoading: (threadId: string, filePath: string, loading: boolean) => void;
  setFileError: (threadId: string, filePath: string, error: string) => void;
  toggleFileExplorer: () => void;
}

export const useFileExplorerStore = create<FileExplorerState>((set, get) => ({
  openTabsByThread: {},
  activeTabByThread: {},
  fileExplorerOpen: false,

  /** 打开文件：已在 tabs 中则切换到它；否则创建新 tab 并异步拉取内容 */
  openFile: (threadId, filePath, fileName) => {
    set((state) => {
      const threadTabs = state.openTabsByThread[threadId] ?? [];
      const exists = threadTabs.find((t) => t.filePath === filePath);
      if (exists) {
        return {
          activeTabByThread: { ...state.activeTabByThread, [threadId]: filePath },
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
          [threadId]: filePath,
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

  /** 关闭 tab：移除后若为 active tab 则回退到最后一个 */
  closeTab: (threadId, filePath) => {
    set((state) => {
      const threadTabs = (state.openTabsByThread[threadId] ?? []).filter(
        (t) => t.filePath !== filePath,
      );
      const active = state.activeTabByThread[threadId];
      let newActive = active;
      if (active === filePath) {
        newActive = threadTabs.length > 0 ? threadTabs[threadTabs.length - 1].filePath : null;
      }
      return {
        openTabsByThread: { ...state.openTabsByThread, [threadId]: threadTabs },
        activeTabByThread: { ...state.activeTabByThread, [threadId]: newActive },
      };
    });
  },

  setActiveTab: (threadId, filePath) => {
    set((state) => ({
      activeTabByThread: { ...state.activeTabByThread, [threadId]: filePath },
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
