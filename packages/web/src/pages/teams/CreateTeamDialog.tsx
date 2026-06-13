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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

/** CreateTeamDialog 组件属性 */
interface CreateTeamDialogProps {
  name: string;
  onNameChange: (name: string) => void;
  description: string;
  onDescriptionChange: (description: string) => void;
  onSubmit: () => void;
  mutation: {
    error: Error | null;
    isPending: boolean;
  };
}

/**
 * 创建团队对话框
 *
 * 提供团队名称和描述输入表单，支持回车快捷提交。
 *
 * @param props - 对话框属性
 */
export default function CreateTeamDialog(props: CreateTeamDialogProps) {
  const { name, onNameChange, description, onDescriptionChange, onSubmit, mutation } = props;
  const { t } = useTranslation('teams');

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
          <Label htmlFor="team-name">{t('teamName')}</Label>
          <Input
            id="team-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t('teamNamePlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit();
            }}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="team-description">{t('teamDesc')}</Label>
          <Textarea
            id="team-description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder={t('teamDescPlaceholder')}
            rows={3}
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
