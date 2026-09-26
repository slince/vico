// 1. 第三方
import { useTranslation } from 'react-i18next';

// 2. Hooks
import { useTheme } from '@/hooks/use-theme';

// 3. UI 组件
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

/** 支持的语言列表，标签以各语言本机名称显示 */
const LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
] as const;

/** 常规设置：界面语言 + 界面主题 */
export default function GeneralSettings() {
  const { t, i18n } = useTranslation('settings');
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('general.language')}</CardTitle>
          <CardDescription>{t('general.languageDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={i18n.language} onValueChange={(lang) => i18n.changeLanguage(lang)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('general.theme')}</CardTitle>
          <CardDescription>{t('general.themeDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark')}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">{t('general.light')}</SelectItem>
              <SelectItem value="dark">{t('general.dark')}</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
    </div>
  );
}
