// 1. React
import { useState, useCallback, type ReactNode } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2 } from 'lucide-react';

// 3. UI components
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogTrigger, DialogContent,
  DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RichtextEditor } from '@/components/ui/richtext-editor';
import { cn } from '@/lib/utils';

interface CreateDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { content: string; filename: string }) => void;
  isPending: boolean;
  trigger?: ReactNode;
}

/**
 * 新建文档弹窗 — 输入文件名和内容后创建并索引，支持全屏编辑。
 */
export function CreateDocumentDialog({
  open, onOpenChange, onSubmit, isPending, trigger,
}: CreateDocumentDialogProps) {
  const { t } = useTranslation('knowledge');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleSubmit = () => {
    onSubmit({ content, filename: name });
    setName('');
    setContent('');
  };

  // 关闭弹窗时重置全屏状态
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setIsFullscreen(false);
    onOpenChange(open);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        className={cn(
          'sm:max-w-3xl',
          isFullscreen && '!max-w-[100vw] !max-h-[100vh] !h-[100vh] !rounded-none !top-0 !left-0 !translate-x-0 !translate-y-0',
        )}
      >
        <DialogHeader>
          <DialogTitle>{t('newDocumentTitle')}</DialogTitle>
          <DialogDescription>{t('newDocumentDesc')}</DialogDescription>
        </DialogHeader>
        <div className={cn('space-y-4', isFullscreen && 'flex-1 min-h-0 flex flex-col')}>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('documentName')}</label>
            <Input
              placeholder={t('documentNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className={cn('space-y-2', isFullscreen && 'flex-1 min-h-0 flex flex-col')}>
            <label className="text-sm font-medium">{t('documentContent')}</label>
            <RichtextEditor
              className={isFullscreen ? 'flex-1 min-h-0' : 'min-h-[400px]'}
              placeholder={t('documentContentPlaceholder')}
              value={content}
              onChange={setContent}
              disabled={isPending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')}
          >
            {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || !content.trim() || isPending}
          >
            {isPending ? t('common:creating') : t('createAndIndex')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
