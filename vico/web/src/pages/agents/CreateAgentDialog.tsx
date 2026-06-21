import { useTranslation } from 'react-i18next';
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** CreateAgentDialog 组件属性 */
interface CreateAgentDialogProps {
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
  mutation: {
    error: Error | null;
    isPending: boolean;
  };
}

/**
 * 创建 Agent 对话框
 *
 * 提供 Agent 名称输入表单，支持回车快捷提交。
 *
 * @param props - 对话框属性
 */
export default function CreateAgentDialog(props: CreateAgentDialogProps) {
  const { name, onNameChange, onSubmit, mutation } = props;
  const { t } = useTranslation('agents');

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t('createDialogTitle')}</DialogTitle>
        <DialogDescription>
          {t('createDialogDesc')}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="agent-name">{t('createDialogNameLabel')}</Label>
          <Input
            id="agent-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t('createDialogNamePlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit();
            }}
          />
        </div>

        {mutation.error && (
          <p className="text-sm text-destructive">
            {mutation.error.message}
          </p>
        )}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">{t('common:cancel')}</Button>
        </DialogClose>
        <Button onClick={onSubmit} disabled={!name.trim() || mutation.isPending}>
          {mutation.isPending ? t('common:creating') : t('common:create')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
