// 1. React
import {useRef, useState} from 'react';

// 2. Third-party
import {useTranslation} from 'react-i18next';
import {Upload} from 'lucide-react';

// 3. UI components
import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (file: File) => void;
  isPending: boolean;
}

/** 截断文件名，保留首尾，超出部分用 ... 代替 */
function truncateFileName(name: string, maxLen = 28): string {
  if (name.length <= maxLen) return name;
  const ext = name.lastIndexOf('.');
  if (ext === -1 || ext === 0) return name.slice(0, maxLen - 1) + '…';
  const extName = name.slice(ext);
  const base = name.slice(0, ext);
  const keepBase = maxLen - extName.length - 1;
  if (keepBase <= 0) return name.slice(0, maxLen - 1) + '…';
  return base.slice(0, keepBase) + '…' + extName;
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
            <Upload className="size-4 shrink-0" />
            <span className="ml-2">{selectedFile ? truncateFileName(selectedFile.name) : t('selectFile')}</span>
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
