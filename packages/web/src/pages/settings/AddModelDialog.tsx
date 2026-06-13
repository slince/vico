import { useTranslation } from 'react-i18next';
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RotateCcw } from 'lucide-react';

/** 提供商预设配置：包含默认的 baseURL 和推荐模型列表 */
const PROVIDER_PRESETS: Record<string, { label: string; baseURL: string; models: string[] }> = {
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
  },
  anthropic: {
    label: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'],
  },
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder'],
  },
  qwen: {
    label: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
  },
  custom: {
    label: '自定义',
    baseURL: '',
    models: [],
  },
};

/** AddModelDialog 组件属性 */
interface AddModelDialogProps {
  /** 当前选中的模型提供商 */
  provider: string;
  /** 提供商变更回调 */
  onProviderChange: (provider: string) => void;
  /** 用户输入的模型名称 */
  modelName: string;
  /** 模型名称变更回调 */
  onModelNameChange: (name: string) => void;
  /** 用户输入的 API Key */
  apiKey: string;
  /** API Key 变更回调 */
  onApiKeyChange: (key: string) => void;
  /** 用户输入的 Base URL */
  baseURL: string;
  /** Base URL 变更回调 */
  onBaseURLChange: (url: string) => void;
  /** 是否显示模型名称建议下拉 */
  showSuggestions: boolean;
  /** 建议下拉显示状态变更回调 */
  onShowSuggestionsChange: (show: boolean) => void;
  /** 当前选中提供商的预设模型列表 */
  currentPresetModels: string[];
  /** 当前 baseURL 与预设是否一致 */
  isBaseURLModified: boolean;
  /** 重置 baseURL 为预设值 */
  onResetBaseURL: () => void;
  /** 选择模型名称建议回调 */
  onModelSuggestionPick: (name: string) => void;
  /** 提交表单回调 */
  onSubmit: () => void;
  /** 是否正在提交中 */
  isPending: boolean;
}

/**
 * 添加 LLM 模型对话框
 *
 * 提供模型提供商选择、模型名称输入（含预设建议）、API Key 和 Base URL 配置表单。
 * Base URL 会根据所选提供商自动填充预设值，支持手动修改后一键重置。
 *
 * @param props - 对话框属性，包括表单状态、变更回调和提交处理
 */
export default function AddModelDialog(props: AddModelDialogProps) {
  const {
    provider,
    onProviderChange,
    modelName,
    onModelNameChange,
    apiKey,
    onApiKeyChange,
    baseURL,
    onBaseURLChange,
    showSuggestions,
    onShowSuggestionsChange,
    currentPresetModels,
    isBaseURLModified,
    onResetBaseURL,
    onModelSuggestionPick,
    onSubmit,
    isPending,
  } = props;

  const { t } = useTranslation('settings');

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t('llm.addDialogTitle')}</DialogTitle>
        <DialogDescription>
          {t('llm.addDialogDesc')}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {/* 提供商 + 模型名称行 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="model-provider">{t('llm.providerLabel')}</Label>
            <Select value={provider} onValueChange={onProviderChange}>
              <SelectTrigger id="model-provider" className="w-full">
                <SelectValue placeholder={t('llm.providerPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
                  <SelectItem key={key} value={key}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* 模型名称输入（含建议下拉） */}
          <div className="space-y-2 relative">
            <Label htmlFor="model-name">{t('llm.modelNameLabel')}</Label>
            <Input
              id="model-name"
              value={modelName}
              onChange={(e) => {
                onModelNameChange(e.target.value);
                onShowSuggestionsChange(true);
              }}
              onFocus={() => onShowSuggestionsChange(true)}
              onBlur={() => setTimeout(() => onShowSuggestionsChange(false), 200)}
              placeholder={t('llm.modelNamePlaceholder', { name: currentPresetModels[0] || 'model-name' })}
            />
            {/* 模型名称建议下拉列表 */}
            {showSuggestions && currentPresetModels.length > 0 && (
              <div className="absolute z-10 top-full mt-0.5 w-full bg-popover border rounded-md shadow-lg py-1">
                {currentPresetModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onMouseDown={() => onModelSuggestionPick(m)}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* API Key 输入 */}
        <div className="space-y-2">
          <Label htmlFor="model-apikey">{t('llm.apiKeyLabel')}</Label>
          <Input
            id="model-apikey"
            type="password"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={t('llm.apiKeyPlaceholder')}
          />
        </div>

        {/* Base URL 输入 */}
        <div className="space-y-2">
          <Label htmlFor="model-baseurl">{t('llm.baseUrlLabel')}</Label>
          <div className="flex gap-1.5">
            <Input
              id="model-baseurl"
              value={baseURL}
              onChange={(e) => onBaseURLChange(e.target.value)}
              placeholder={PROVIDER_PRESETS[provider]?.baseURL || 'https://api.example.com/v1'}
              className="flex-1"
            />
            {/* 仅在 Base URL 被修改后显示重置按钮 */}
            {isBaseURLModified && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={onResetBaseURL}
                title={t('llm.baseUrlReset')}
              >
                <RotateCcw className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      <DialogFooter showCloseButton>
        <Button
          onClick={onSubmit}
          disabled={!modelName.trim() || !apiKey.trim() || isPending}
        >
          {isPending ? t('llm.adding') : t('llm.add')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
