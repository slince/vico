import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isPending: boolean;
  isDir: boolean;
  name: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  children: ReactNode;
}

/**
 * 删除确认弹窗 — 文档和目录通用。
 * 触发按钮通过 children 传入，由调用方控制样式。
 */
export function DeleteConfirmDialog({
  open, onOpenChange, onConfirm, isPending, isDir, name, t, children,
}: DeleteConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        {children}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isDir ? t('deleteFolder') : t('deleteDocument')}</AlertDialogTitle>
          <AlertDialogDescription>
            {isDir ? t('confirmDeleteFolder', { name }) : t('confirmDeleteDoc', { name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? t('common:deleting') : t('common:confirmDelete')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
