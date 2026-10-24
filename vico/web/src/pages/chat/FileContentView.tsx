'use client';

import { useCallback } from 'react';

import { FileContentViewer } from '@/components/file-explorer/FileContentViewer';
import { useFileExplorerStore, type OpenFileTab } from '@/stores/fileExplorerStore';

/**
 * 文件内容视图适配器 — 连接可复用 FileContentViewer 与 fileExplorerStore。
 *
 * 将 store 中的文件 tab（内容 / 加载态 / 错误）映射为 viewer 的 props，
 * 并把 viewer 的 reload / save 回调接到后端的 fs read / write 接口与 store 更新。
 */
export function FileContentView({ threadId, tab }: { threadId: string; tab: OpenFileTab }) {
  const setFileContent = useFileExplorerStore((s) => s.setFileContent);
  const setFileError = useFileExplorerStore((s) => s.setFileError);
  const setFileLoading = useFileExplorerStore((s) => s.setFileLoading);

  /** 重新从后端读取文件内容并更新 store */
  const reload = useCallback(() => {
    setFileLoading(threadId, tab.filePath, true);
    fetch(
      `/api/v1/threads/${threadId}/fs/read?path=${encodeURIComponent(tab.filePath)}`,
      { credentials: 'include' },
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setFileContent(threadId, tab.filePath, data.content);
      })
      .catch((err) => {
        setFileError(threadId, tab.filePath, err.message);
      });
  }, [threadId, tab.filePath, setFileContent, setFileError, setFileLoading]);

  /** 保存草稿到后端，成功后同步进 store（错误同样写入 store，供 viewer 展示） */
  const save = useCallback(
    async (content: string) => {
      try {
        const res = await fetch(`/api/v1/threads/${threadId}/fs/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ path: tab.filePath, content }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setFileContent(threadId, tab.filePath, content);
      } catch (err) {
        setFileError(threadId, tab.filePath, err instanceof Error ? err.message : String(err));
      }
    },
    [threadId, tab.filePath, setFileContent, setFileError],
  );

  return (
    <FileContentViewer
      filePath={tab.filePath}
      fileName={tab.fileName}
      content={tab.content}
      isLoading={tab.isLoading}
      error={tab.error}
      onReload={reload}
      onSave={save}
    />
  );
}
