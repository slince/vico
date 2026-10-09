// 1. React
import { useState } from 'react';

// 2. 第三方
import { useTranslation } from 'react-i18next';

// 3. Hooks
import { useTheme } from '@/hooks/use-theme';
import { useFontSize } from '@/hooks/use-font-size';

// 4. UI 组件
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';

/** 支持的语言列表，标签以各语言本机名称显示 */
const LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
] as const;

/** 常规设置：界面语言 + 界面主题 + 会话字体大小 */
export default function GeneralSettings() {
  const { t, i18n } = useTranslation('settings');
  const { theme, setTheme } = useTheme();
  const { fontSize, setFontSize } = useFontSize();
  // 输入框本地态，允许临时清空（失焦时回填），避免受控值在删除时跳字
  const [fontInput, setFontInput] = useState(String(fontSize));

  /** 仅保留数字并同步到全局状态；空值不提交 */
  const handleFontSizeChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    setFontInput(digits);
    const n = Number(digits);
    if (digits !== '' && n > 0) setFontSize(n);
  };

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

      <Card>
        <CardHeader>
          <CardTitle>{t('general.fontSize')}</CardTitle>
          <CardDescription>{t('general.fontSizeDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Input
              value={fontInput}
              onChange={(e) => handleFontSizeChange(e.target.value)}
              onBlur={() => {
                if (fontInput === '' || Number(fontInput) <= 0) setFontInput(String(fontSize));
              }}
              inputMode="numeric"
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">px</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
