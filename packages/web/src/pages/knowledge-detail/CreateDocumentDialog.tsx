// 1. React
import { useState, type ReactNode } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';

// 3. UI components
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogTrigger, DialogContent,
  DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface CreateDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { content: string; filename: string }) => void;
  isPending: boolean;
  trigger: ReactNode;
}

/**
 * 新建文档弹窗 — 输入文件名和内容后创建并索引。
 */
export function CreateDocumentDialog({
  open, onOpenChange, onSubmit, isPending, trigger,
}: CreateDocumentDialogProps) {
  const { t } = useTranslation('knowledge');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');

  const handleSubmit = () => {
    onSubmit({ content, filename: name });
    setName('');
    setContent('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('newDocumentTitle')}</DialogTitle>
          <DialogDescription>{t('newDocumentDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('documentName')}</label>
            <Input
              placeholder={t('documentNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('documentContent')}</label>
            <Textarea
              className="min-h-[200px]"
              placeholder={t('documentContentPlaceholder')}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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
