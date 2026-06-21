import type { LucideIcon } from 'lucide-react';
import { File, FileImage, FileSpreadsheet, FileText, Presentation } from 'lucide-react';

/** 将字节数转换为可读的文件大小 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 根据 mime 类型返回文件图标和颜色 */
export function getFileIcon(fileType: string): { icon: LucideIcon; colorClass: string } {
  if (fileType.startsWith('image/')) {
    return { icon: FileImage, colorClass: 'text-sky-500' };
  }
  if (fileType === 'application/pdf') {
    return { icon: FileText, colorClass: 'text-red-500' };
  }
  if (fileType.includes('spreadsheet') || fileType.includes('excel') || fileType === 'application/vnd.ms-excel') {
    return { icon: FileSpreadsheet, colorClass: 'text-green-500' };
  }
  if (fileType.includes('presentation') || fileType.includes('powerpoint') || fileType === 'application/vnd.ms-powerpoint') {
    return { icon: Presentation, colorClass: 'text-orange-500' };
  }
  if (fileType.includes('msword') || fileType.includes('wordprocessing') || fileType === 'application/msword') {
    return { icon: FileText, colorClass: 'text-blue-500' };
  }
  if (fileType.startsWith('text/')) {
    return { icon: FileText, colorClass: 'text-muted-foreground' };
  }
  return { icon: File, colorClass: 'text-muted-foreground' };
}

/** 根据文档状态返回 Badge 的 variant 和样式类名 */
export function getStatusBadgeProps(status: string): { variant: 'destructive' | 'secondary'; className: string } {
  switch (status) {
    case 'ready':
      return { variant: 'secondary', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' };
    case 'indexing':
    case 'parsing':
      return { variant: 'secondary', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
    case 'error':
      return { variant: 'destructive', className: '' };
    case 'pending':
    default:
      return { variant: 'secondary', className: '' };
  }
}

/** 将文档状态映射为翻译 key */
export function getStatusKey(status: string): string {
  switch (status) {
    case 'ready': return 'statusReady';
    case 'indexing': return 'statusIndexing';
    case 'parsing': return 'statusParsing';
    case 'error': return 'statusError';
    case 'pending': return 'statusPending';
    default: return status;
  }
}

import type { DocumentItem } from './types';

/** 文档视图组件的公共 Props */
export interface DocumentViewProps {
  documents: DocumentItem[];
  selectedDocId: string | null;
  deleteDocId: string | null;
  onSelectDoc: (doc: DocumentItem) => void;
  onDeleteDocIdChange: (id: string | null) => void;
  onDeleteConfirm: () => void;
  deletePending: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}
