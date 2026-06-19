// 2. Third-party
import { FileText, Folder, Trash2 } from 'lucide-react';

// 3. UI components
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';

import type { DocumentViewProps } from './utils';
import { formatFileSize, getFileIcon, getStatusBadgeProps, getStatusKey } from './utils';
import { isDirectory, getDirectoryName } from './types';

/**
 * 文档列表视图 — 表格形式。
 */
export function DocumentTable({
  documents, selectedDocId, deleteDocId,
  onSelectDoc, onDeleteDocIdChange, onDeleteConfirm, deletePending,
  t,
}: DocumentViewProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('name')}</TableHead>
          <TableHead>{t('colType')}</TableHead>
          <TableHead>{t('colSize')}</TableHead>
          <TableHead>{t('colStatus')}</TableHead>
          <TableHead>{t('colChunks')}</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((doc) => {
          const badgeProps = getStatusBadgeProps(doc.status);
          const isSelected = selectedDocId === doc.id;
          const dir = isDirectory(doc);
          const displayName = dir ? getDirectoryName(doc) : doc.filename;
          const { icon: FileIcon, colorClass } = dir ? { icon: Folder, colorClass: 'text-amber-500' } : getFileIcon(doc.file_type);
          return (
            <TableRow
              key={doc.id}
              className={`cursor-pointer transition-colors ${isSelected ? 'bg-accent' : 'hover:bg-muted/50'}`}
              onClick={() => onSelectDoc(doc)}
            >
              <TableCell className="font-medium max-w-48 truncate">
                <span className="inline-flex items-center gap-1.5">
                  <FileIcon className={`size-4 shrink-0 ${colorClass}`} />
                  {displayName}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground uppercase text-xs">
                {dir ? '—' : doc.file_type || '-'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {dir ? '—' : formatFileSize(doc.file_size)}
              </TableCell>
              <TableCell>
                <Badge variant={badgeProps.variant} className={badgeProps.className}>
                  {dir ? t('folderType') : t(getStatusKey(doc.status))}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {dir ? '—' : doc.chunk_count}
              </TableCell>
              <TableCell>
                <AlertDialog
                  open={deleteDocId === doc.id}
                  onOpenChange={(open) => { if (!open) onDeleteDocIdChange(null); }}
                >
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); onDeleteDocIdChange(doc.id); }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{dir ? t('deleteFolder') : t('deleteDocument')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {dir ? t('confirmDeleteFolder', { name: displayName }) : t('confirmDeleteDoc', { name: doc.filename })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <Button variant="outline" onClick={() => onDeleteDocIdChange(null)}>
                        {t('common:cancel')}
                      </Button>
                      <Button variant="destructive" onClick={onDeleteConfirm} disabled={deletePending}>
                        {deletePending ? t('common:deleting') : t('common:confirmDelete')}
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** 表格视图的加载骨架 */
export function DocumentTableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** 表格视图的空态 */
export function DocumentTableEmpty({ t }: { t: DocumentViewProps['t'] }) {
  return (
    <Empty>
      <EmptyMedia variant="icon">
        <FileText size={24} />
      </EmptyMedia>
      <EmptyTitle>{t('noDocuments')}</EmptyTitle>
    </Empty>
  );
}
