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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RotateCcw } from 'lucide-react';
import { MODEL_TYPES, type ModelType, type ProviderEntry } from './providers';
import { ProviderCombobox } from './ProviderCombobox';

/** AddModelDialog 组件属性 */
interface AddModelDialogProps {
  /** 是否为编辑模式（否则为新增模式） */
  isEdit: boolean;
  /** 当前模型类型 */
  modelType: ModelType;
  /** 模型类型变更回调（编辑模式下类型被锁定，不触发） */
  onModelTypeChange: (type: ModelType) => void;
  /** 当前类型下可选的厂商列表（已按类型过滤，generic 恒保留） */
  providers: ProviderEntry[];
  /** 当前选中的厂商 ID */
  provider: string;
  /** 厂商变更回调 */
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
  /** 当前厂商 + 类型下的模型名建议列表 */
  currentSuggestions: string[];
  /** 当前 baseURL 与厂商预设是否一致 */
  isBaseURLModified: boolean;
  /** 重置 baseURL 为预设值 */
  onResetBaseURL: () => void;
  /** 选择模型名称建议回调 */
  onModelSuggestionPick: (name: string) => void;
  /** 是否设为默认模型 */
  isDefault: boolean;
  /** 默认模型状态变更回调 */
  onIsDefaultChange: (isDefault: boolean) => void;
  /** 提交表单回调 */
  onSubmit: () => void;
  /** 是否正在提交中 */
  isPending: boolean;
}

/**
 * 添加/编辑模型对话框
 *
 * 按模型类型组织表单：模型类型 → 提供商（来自 catalog 接口）→ 模型名称（含建议下拉）
 * → API Key → Base URL（按厂商自动填充，可改可重置）→ 设为默认。
 *
 * @param props - 对话框属性，包括表单状态、变更回调和提交处理
 */
export default function AddModelDialog(props: AddModelDialogProps) {
  const {
    isEdit,
    modelType,
    onModelTypeChange,
    providers,
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
    currentSuggestions,
    isBaseURLModified,
    onResetBaseURL,
    onModelSuggestionPick,
    isDefault,
    onIsDefaultChange,
    onSubmit,
    isPending,
  } = props;

  const { t } = useTranslation('settings');

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{isEdit ? t('llm.editDialogTitle') : t('llm.addDialogTitle')}</DialogTitle>
        <DialogDescription>
          {isEdit ? t('llm.editDialogDesc') : t('llm.addDialogDesc')}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {/* 模型类型 + 提供商 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="model-type">{t('llm.typeLabel')}</Label>
            <Select value={modelType} onValueChange={(v) => onModelTypeChange(v as ModelType)} disabled={isEdit}>
              <SelectTrigger id="model-type" className="w-full">
                <SelectValue placeholder={t('llm.typePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {MODEL_TYPES.map((mt) => (
                  <SelectItem key={mt.value} value={mt.value}>
                    {t(mt.i18nKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('llm.providerLabel')}</Label>
            <ProviderCombobox
              providers={providers}
              value={provider}
              onChange={onProviderChange}
              placeholder={t('llm.providerPlaceholder')}
            />
          </div>
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
            placeholder={t('llm.modelNamePlaceholder', { name: currentSuggestions[0] || 'model-name' })}
          />
          {/* 模型名称建议下拉列表 */}
          {showSuggestions && currentSuggestions.length > 0 && (
            <div className="absolute z-10 top-full mt-0.5 w-full bg-popover border rounded-md shadow-lg py-1 max-h-56 overflow-y-auto">
              {currentSuggestions.map((m) => (
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

        {/* API Key 输入 */}
        <div className="space-y-2">
          <Label htmlFor="model-apikey">{t('llm.apiKeyLabel')}</Label>
          <Input
            id="model-apikey"
            type="password"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={isEdit ? t('llm.apiKeyKeepHint') : t('llm.apiKeyPlaceholder')}
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
              placeholder="https://api.example.com/v1"
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

        {/* 设为默认 */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="model-is-default"
            checked={isDefault}
            onCheckedChange={(checked) => onIsDefaultChange(checked === true)}
          />
          <Label htmlFor="model-is-default" className="cursor-pointer text-sm font-normal">
            {t('llm.isDefaultLabel')}
          </Label>
        </div>
      </div>
      <DialogFooter showCloseButton>
        <Button
          onClick={onSubmit}
          disabled={!modelName.trim() || (!isEdit && !apiKey.trim()) || isPending}
        >
          {isPending ? (isEdit ? t('llm.saving') : t('llm.adding')) : (isEdit ? t('llm.save') : t('llm.add'))}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
