import { useTranslation } from 'react-i18next';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** 支持的语言列表，标签以各语言本机名称显示 */
const LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
] as const;

/**
 * 语言切换器组件
 *
 * 通过 Select 下拉选择界面语言，调用 i18n.changeLanguage() 立即生效。
 * 语言偏好通过 i18next-browser-languagedetector 自动持久化到 localStorage。
 */
export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation('settings');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('general.language')}</CardTitle>
        <CardDescription>{t('general.languageDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Select
          value={i18n.language}
          onValueChange={(lang) => i18n.changeLanguage(lang)}
        >
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
  );
}
