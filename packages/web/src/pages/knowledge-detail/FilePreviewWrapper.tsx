import { useMemo } from 'react';
import { FilePreviewModal, type PreviewFileInput } from '@eternalheart/react-file-preview';
import type { DocumentItem } from './types';
import { isDirectory } from './types';

interface FilePreviewWrapperProps {
  open: boolean;
  onClose: () => void;
  /** 当前目录下的全部文档 */
  documents: DocumentItem[];
  /** 当前选中文件索引（过滤后列表中的位置） */
  selectedDocId: string;
  /** 知识库 ID，用于构建预览 URL */
  kbId: string;
}

/**
 * 文件预览弹窗包装。
 * 从文档列表中过滤出可预览的文件（非目录、就绪态、有 storage_key），构建 URL 对象传给 FilePreviewModal。
 */
export function FilePreviewWrapper({
  open, onClose, documents, selectedDocId, kbId,
}: FilePreviewWrapperProps) {
  // 构建可预览文件列表
  const { files, currentIndex } = useMemo(() => {
    const previewFiles: PreviewFileInput[] = [];
    let targetIndex = 0;
    for (const doc of documents) {
      if (isDirectory(doc) || doc.status !== 'ready' || !doc.storage_key) continue;
      previewFiles.push({
        name: doc.filename,
        type: doc.file_type,
        url: `/api/v1/knowledge-bases/${kbId}/documents/${doc.id}/preview`,
      });
      if (doc.id === selectedDocId) {
        targetIndex = previewFiles.length - 1;
      }
    }
    return { files: previewFiles, currentIndex: targetIndex };
  }, [documents, selectedDocId, kbId]);

  if (!open) return null;

  return (
    <FilePreviewModal
      files={files}
      currentIndex={currentIndex}
      isOpen={open}
      onClose={onClose}
      locale="zh-CN"
      theme="dark"
    />
  );
}
