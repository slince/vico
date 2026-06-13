// 1. React
import { useCallback, useState } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Check, Pencil, Settings as SettingsIcon } from 'lucide-react';

// 3. API
import { api } from '@/api/client';

// 4. UI components
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import {
  Dialog,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';

// 5. Sub-components
import AddModelDialog from './settings/AddModelDialog';
import LanguageSwitcher from './settings/LanguageSwitcher';

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

/** LLM 模型数据结构 */
interface ModelEntry {
  id: string;
  provider: string;
  model_name: string;
  api_key_encrypted: string;
  base_url: string | null;
  is_default: number;
}

/**
 * 设置页面
 *
 * 通过 Tabs 组织两个功能区：
 * 1. 通用设置 — 界面语言切换
 * 2. LLM 模型 — AI 模型提供商配置
 */
export default function Settings() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState('general');

  // ---------- LLM 对话框状态 ----------
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // ---------- LLM 表单状态 ----------
  const [provider, setProvider] = useState('openai');
  const [modelName, setModelName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState(PROVIDER_PRESETS.openai.baseURL);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  // ---------- 数据获取 ----------
  const { data: models, isLoading } = useQuery<ModelEntry[]>({
    queryKey: ['models'],
    queryFn: () => api('/models'),
  });

  // ---------- 派生数据 ----------
  const modelsList = models || [];
  const currentPresetModels = PROVIDER_PRESETS[provider]?.models || [];
  const isBaseURLModified = !!(PROVIDER_PRESETS[provider]?.baseURL && baseURL !== PROVIDER_PRESETS[provider].baseURL);

  // ---------- 变更操作 ----------

  const addMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api('/models', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      resetFormDialog();
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api(`/models/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      resetFormDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/models/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      setDeleteTargetId(null);
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/models/${id}`, { method: 'PATCH', body: JSON.stringify({ is_default: 1 }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
    },
  });

  // ---------- 辅助函数 ----------

  /** 重置表单状态并关闭对话框 */
  const resetFormDialog = useCallback(() => {
    setAddDialogOpen(false);
    setEditingModelId(null);
    setModelName('');
    setApiKey('');
    setProvider('openai');
    setBaseURL(PROVIDER_PRESETS.openai.baseURL);
    setIsDefault(false);
  }, []);

  /** 打开新增模型对话框 */
  const openAddDialog = useCallback(() => {
    setEditingModelId(null);
    setModelName('');
    setApiKey('');
    setProvider('openai');
    setBaseURL(PROVIDER_PRESETS.openai.baseURL);
    setIsDefault(modelsList.length === 0);
    setAddDialogOpen(true);
  }, [modelsList.length]);

  /** 打开编辑模型对话框，预填已有数据 */
  const openEditDialog = useCallback((model: ModelEntry) => {
    setEditingModelId(model.id);
    setProvider(model.provider);
    setModelName(model.model_name);
    setApiKey('');
    setBaseURL(model.base_url || PROVIDER_PRESETS[model.provider]?.baseURL || '');
    setIsDefault(model.is_default === 1);
    setAddDialogOpen(true);
  }, []);

  // ---------- 事件处理 ----------

  const handleProviderChange = useCallback((newProvider: string) => {
    setProvider(newProvider);
    const preset = PROVIDER_PRESETS[newProvider];
    if (preset) {
      setBaseURL(preset.baseURL);
    }
  }, []);

  const handleModelSuggestionPick = useCallback((name: string) => {
    setModelName(name);
    setShowSuggestions(false);
  }, []);

  const handleResetBaseURL = useCallback(() => {
    const preset = PROVIDER_PRESETS[provider];
    if (preset) {
      setBaseURL(preset.baseURL);
    }
  }, [provider]);

  const handleSubmit = useCallback(() => {
    if (!modelName.trim()) return;
    if (!editingModelId && !apiKey.trim()) return;

    if (editingModelId) {
      // 编辑模式：只发送变更的字段，apiKey 为空则不更新
      const patchData: Record<string, unknown> = {
        provider,
        model_name: modelName.trim(),
        base_url: baseURL || null,
        is_default: isDefault ? 1 : 0,
      };
      if (apiKey.trim()) {
        patchData.api_key_encrypted = apiKey.trim();
      }
      editMutation.mutate({ id: editingModelId, data: patchData });
    } else {
      // 新增模式
      addMutation.mutate({
        provider,
        model_name: modelName.trim(),
        api_key_encrypted: apiKey.trim(),
        base_url: baseURL || null,
        is_default: isDefault ? 1 : 0,
      });
    }
  }, [editingModelId, modelName, apiKey, provider, baseURL, addMutation, editMutation, modelsList.length]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTargetId) {
      deleteMutation.mutate(deleteTargetId);
    }
  }, [deleteTargetId, deleteMutation]);

  // ---------- 加载态 ----------
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="py-6">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-3 w-72 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ---------- 渲染 ----------
  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <h2 className="text-2xl font-bold tracking-tight">{t('title')}</h2>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="general">
            <SettingsIcon size={14} className="mr-1.5" />
            {t('general.tab')}
          </TabsTrigger>
          <TabsTrigger value="llm">
            <Check size={14} className="mr-1.5" />
            {t('llm.tab')}
          </TabsTrigger>
        </TabsList>

        {/* 通用设置 Tab */}
        <TabsContent value="general">
          <div className="mt-4 space-y-4">
            <LanguageSwitcher />
          </div>
        </TabsContent>

        {/* LLM 模型 Tab */}
        <TabsContent value="llm">
          <div className="mt-4 space-y-4">
            {/* 操作栏 */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">{t('llm.title')}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('llm.description')}
                </p>
              </div>
              <Dialog open={addDialogOpen} onOpenChange={(open) => { if (!open) resetFormDialog(); }}>
                <DialogTrigger asChild>
                  <Button onClick={openAddDialog}>
                    <Plus className="size-4" />
                    {t('llm.addModel')}
                  </Button>
                </DialogTrigger>
                <AddModelDialog
                  isEdit={!!editingModelId}
                  provider={provider}
                  onProviderChange={handleProviderChange}
                  modelName={modelName}
                  onModelNameChange={setModelName}
                  apiKey={apiKey}
                  onApiKeyChange={setApiKey}
                  baseURL={baseURL}
                  onBaseURLChange={setBaseURL}
                  showSuggestions={showSuggestions}
                  onShowSuggestionsChange={setShowSuggestions}
                  currentPresetModels={currentPresetModels}
                  isBaseURLModified={isBaseURLModified}
                  onResetBaseURL={handleResetBaseURL}
                  onModelSuggestionPick={handleModelSuggestionPick}
                  isDefault={isDefault}
                  onIsDefaultChange={setIsDefault}
                  onSubmit={handleSubmit}
                  isPending={addMutation.isPending || editMutation.isPending}
                />
              </Dialog>
            </div>

            {/* 空状态 */}
            {modelsList.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t('llm.emptyTitle')}</EmptyTitle>
                  <EmptyDescription>{t('llm.emptyDescription')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              /* 模型列表 */
              <div className="space-y-3">
                {modelsList.map((m) => (
                  <Card key={m.id}>
                    <CardContent className="py-0">
                      <div className="flex items-center justify-between py-4">
                        <div className="flex items-center gap-3 min-w-0">
                          {m.is_default === 1 && (
                            <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600">
                              <Check className="size-3" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium truncate">
                              {m.provider} / {m.model_name}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              API Key: {m.api_key_encrypted.slice(0, 8)}...
                              {m.base_url ? ` \u00b7 ${m.base_url}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {m.is_default !== 1 && (
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => setDefaultMutation.mutate(m.id)}
                              disabled={setDefaultMutation.isPending}
                            >
                              {t('llm.setDefault')}
                            </Button>
                          )}
                          {m.is_default === 1 && (
                            <Badge variant="default">{t('llm.defaultBadge')}</Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => openEditDialog(m)}
                          >
                            <Pencil className="size-3.5" />
                            <span className="sr-only">{t('llm.edit')}</span>
                          </Button>
                          <AlertDialog
                            open={deleteTargetId === m.id}
                            onOpenChange={(open) => {
                              if (!open) setDeleteTargetId(null);
                            }}
                          >
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteTargetId(m.id)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t('llm.confirmDeleteTitle')}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t('llm.confirmDeleteDesc', { name: `${m.provider} / ${m.model_name}` })}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <Button
                                  variant="outline"
                                  onClick={() => setDeleteTargetId(null)}
                                >
                                  {t('llm.cancel')}
                                </Button>
                                <Button
                                  variant="destructive"
                                  onClick={handleDeleteConfirm}
                                  disabled={deleteMutation.isPending}
                                >
                                  {deleteMutation.isPending ? t('common:deleting') : t('common:confirmDelete')}
                                </Button>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
