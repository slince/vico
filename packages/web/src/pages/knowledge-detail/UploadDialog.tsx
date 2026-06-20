// 1. React
import { useRef, useState } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';

// 3. UI components
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent,
  DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (file: File) => void;
  isPending: boolean;
}

/**
 * 上传文件弹窗 — 选择文件并上传到知识库。
 */
export function UploadDialog({
  open, onOpenChange, onSubmit, isPending,
}: UploadDialogProps) {
  const { t } = useTranslation('knowledge');
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  const handleSubmit = () => {
    if (selectedFile) {
      onSubmit(selectedFile);
      setSelectedFile(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) setSelectedFile(null); onOpenChange(open); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('uploadDialogTitle')}</DialogTitle>
          <DialogDescription>{t('uploadDialogDesc')}</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
            accept=".pdf,.txt,.md,.csv,.py,.js,.json,.html"
          />
          <Button variant="outline" className="w-full" onClick={() => inputRef.current?.click()}>
            <Upload className="size-4" />
            <span className="ml-2">{selectedFile ? selectedFile.name : t('selectFile')}</span>
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!selectedFile || isPending}>
            {isPending ? t('uploading') : t('common:confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
