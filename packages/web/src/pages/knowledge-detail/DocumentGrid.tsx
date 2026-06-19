// 2. Third-party
import { FileText, Folder, Trash2 } from 'lucide-react';

// 3. UI components
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';

import type { DocumentViewProps } from './utils';
import { formatFileSize, getFileIcon, getStatusBadgeProps, getStatusKey } from './utils';
import { isDirectory, getDirectoryName } from './types';

/**
 * 文档网格视图 — 卡片形式。
 */
export function DocumentGrid({
  documents, selectedDocId, deleteDocId,
  onSelectDoc, onDeleteDocIdChange, onDeleteConfirm, deletePending,
  t,
}: DocumentViewProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {documents.map((doc) => {
        const badgeProps = getStatusBadgeProps(doc.status);
        const isSelected = selectedDocId === doc.id;
        const dir = isDirectory(doc);
        const displayName = dir ? getDirectoryName(doc) : doc.filename;
        const { icon: FileIcon, colorClass } = dir ? { icon: Folder, colorClass: 'text-amber-500' } : getFileIcon(doc.file_type);
        return (
          <Card
            key={doc.id}
            className={`cursor-pointer transition-colors group ${isSelected ? 'ring-2 ring-primary' : 'hover:bg-muted/50'}`}
            onClick={() => onSelectDoc(doc)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="shrink-0 size-10 rounded-md bg-muted flex items-center justify-center">
                    <FileIcon className={`size-5 ${colorClass}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{displayName}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      {dir ? (
                        <span>{t('folderType')}</span>
                      ) : (
                        <>
                          <span className="uppercase">{doc.file_type || '-'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatFileSize(doc.file_size)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <AlertDialog
                  open={deleteDocId === doc.id}
                  onOpenChange={(open) => { if (!open) onDeleteDocIdChange(null); }}
                >
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
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
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Badge variant={badgeProps.variant} className={badgeProps.className}>
                  {dir ? t('folderType') : t(getStatusKey(doc.status))}
                </Badge>
                {!dir && (
                  <span className="text-xs text-muted-foreground">
                    {t('chunkCount', { count: doc.chunk_count })}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/** 网格视图的加载骨架 */
export function DocumentGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Skeleton className="size-10 rounded-md shrink-0" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <Skeleton className="h-5 w-12 rounded-full" />
              <Skeleton className="h-5 w-16" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** 网格视图的空态 */
export function DocumentGridEmpty({ t }: { t: DocumentViewProps['t'] }) {
  return (
    <Empty>
      <EmptyMedia variant="icon">
        <FileText size={24} />
      </EmptyMedia>
      <EmptyTitle>{t('noDocuments')}</EmptyTitle>
    </Empty>
  );
}
