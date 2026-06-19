// 1. React
import { useState } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';

// 3. UI components
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent,
  DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string }) => void;
  isPending: boolean;
}

/**
 * 新建目录弹窗 — 输入目录名称后创建。
 */
export function CreateFolderDialog({
  open, onOpenChange, onSubmit, isPending,
}: CreateFolderDialogProps) {
  const { t } = useTranslation('knowledge');
  const [name, setName] = useState('');

  const handleSubmit = () => {
    onSubmit({ name: name.trim() });
    setName('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('newFolderTitle')}</DialogTitle>
          <DialogDescription>{t('newFolderDesc')}</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('folderName')}</label>
            <Input
              placeholder={t('folderNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || isPending}>
            {isPending ? t('common:creating') : t('common:create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
