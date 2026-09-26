// 1. React
import { useState } from 'react';

// 2. 第三方
import { useTranslation } from 'react-i18next';

// 4. UI 组件
import {
  DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AddUserDialogProps {
  /** 提交回调 */
  onSubmit: (data: { username: string; name: string; email: string; password: string }) => void;
  /** 是否提交中 */
  isPending: boolean;
}

/** 添加成员对话框：用户名 + 姓名 + 邮箱 + 密码 */
export default function AddUserDialog({ onSubmit, isPending }: AddUserDialogProps) {
  const { t } = useTranslation('settings');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const canSubmit =
    username.trim().length >= 2 &&
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({ username: username.trim(), name: name.trim(), email: email.trim(), password });
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{t('users.addDialogTitle')}</DialogTitle>
        <DialogDescription>{t('users.addDialogDesc')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="user-username">{t('users.username')}</Label>
          <Input
            id="user-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t('users.usernamePlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-name">{t('users.name')}</Label>
          <Input
            id="user-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('users.namePlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-email">{t('users.email')}</Label>
          <Input
            id="user-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('users.emailPlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-password">{t('users.password')}</Label>
          <Input
            id="user-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('users.passwordPlaceholder')}
          />
        </div>
      </div>
      <DialogFooter showCloseButton>
        <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
          {isPending ? t('common:creating') : t('common:create')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
