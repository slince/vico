/**
 * 文件引用上下文 — 向消息渲染树（markdown 文本 / 工具卡片）注入 threadId 与打开文件能力。
 *
 * 文件链接点击需要真实 threadId（后端 workspace 按线程解析），但消息组件由
 * assistant-ui 深层渲染，无法直接拿到 URL 中的 threadId，故通过 React Context
 * 在 ChatPanel 层注入。无 Provider 时 `useFileReference` 返回空实现，文件链接退化为纯文本。
 */
'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { basename } from '@/lib/file-link';

/** 文件引用上下文值 */
export interface FileReferenceContextValue {
  /** 当前线程真实 ID；新会话（尚未创建线程）为 null */
  threadId: string | null;
  /** 打开文件引用：展开右侧面板并激活对应文件 tab */
  openFileReference: (path: string) => void;
}

/** 默认空实现 — 无 Provider 时文件链接退化为纯文本，保证安全 */
const DEFAULT_VALUE: FileReferenceContextValue = {
  threadId: null,
  openFileReference: () => {},
};

const FileReferenceContext = createContext<FileReferenceContextValue>(DEFAULT_VALUE);

/** 读取文件引用上下文（threadId + openFileReference） */
export function useFileReference(): FileReferenceContextValue {
  return useContext(FileReferenceContext);
}

interface FileReferenceProviderProps {
  /** 当前线程真实 ID（可空） */
  threadId: string | null;
  children: ReactNode;
}

/**
 * 文件引用 Provider — 把 threadId 绑定到打开文件的动作。
 *
 * openFileReference 内部：强制展开右侧面板 + 打开/激活该文件 tab（触发内容拉取）。
 * 文件名为路径末段；文件不存在时由 store 的 setFileError 在预览面板展示错误。
 */
export function FileReferenceProvider({ threadId, children }: FileReferenceProviderProps) {
  const openFileReference = useCallback(
    (path: string) => {
      if (!threadId) return;
      const store = useFileExplorerStore.getState();
      store.setFileExplorerOpen(true);
      store.openFile(threadId, path, basename(path));
    },
    [threadId],
  );

  const value = useMemo(
    () => ({ threadId, openFileReference }),
    [threadId, openFileReference],
  );

  return <FileReferenceContext.Provider value={value}>{children}</FileReferenceContext.Provider>;
}
