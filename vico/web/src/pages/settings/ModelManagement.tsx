// 1. React
import { useCallback, useMemo, useState } from 'react';

// 2. 第三方
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Check, Pencil } from 'lucide-react';

// 3. API
import { api } from '@/api/client';

// 4. UI 组件
import {
  Card, CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';

// 5. 页面子组件
import AddModelDialog from './AddModelDialog';
import {
  MODEL_TYPES,
  filterProvidersByType,
  getProviderBaseUrl,
  getModelSuggestions,
  type LlmCatalog,
  type ModelType,
} from './providers';

/** LLM 模型数据结构 */
interface ModelEntry {
  id: string;
  provider: string;
  model_name: string;
  api_key: string;
  base_url: string | null;
  model_type: string;
  is_default: number;
}

/**
 * 模型管理 section：按模型类型（对话/向量/重排/视觉/语音）分 tab 展示，
 * 支持增/改/删/按类型设默认。
 * 非 admin（isAdmin=false）隐藏所有写操作按钮，列表只读。
 */
export default function ModelManagement({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();

  const [activeType, setActiveType] = useState<ModelType>('chat');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // 表单状态（对话框内）
  const [formType, setFormType] = useState<ModelType>('chat');
  const [provider, setProvider] = useState('');
  const [modelName, setModelName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  const { data: models, isLoading } = useQuery<ModelEntry[]>({
    queryKey: ['models'],
    queryFn: () => api('/models'),
  });

  const { data: catalog } = useQuery<LlmCatalog>({
    queryKey: ['llm-providers'],
    queryFn: () => api('/llm-providers'),
  });

  const modelsList = models || [];
  const providers = catalog?.providers ?? [];

  // 当前对话框类型下可选的厂商列表（generic 恒保留）
  const availableProviders = useMemo(
    () => filterProvidersByType(providers, formType),
    [providers, formType],
  );
  const selectedProviderEntry = availableProviders.find((p) => p.id === provider);
  const currentSuggestions = getModelSuggestions(selectedProviderEntry, formType);
  const defaultBaseUrl = getProviderBaseUrl(selectedProviderEntry, formType);
  const isBaseURLModified = !!defaultBaseUrl && baseURL !== defaultBaseUrl;

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
    mutationFn: (id: string) => api(`/models/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      setDeleteTargetId(null);
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/models/${id}`, { method: 'PATCH', body: JSON.stringify({ is_default: 1 }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
  });

  /** 切换对话框模型类型：重置厂商为第一个可用项，并刷新 Base URL 与建议 */
  const applyType = useCallback((type: ModelType) => {
    setFormType(type);
    const list = filterProvidersByType(providers, type);
    const first = list[0];
    setProvider(first?.id ?? '');
    setBaseURL(getProviderBaseUrl(first, type));
    setModelName('');
  }, [providers]);

  const resetFormDialog = useCallback(() => {
    setAddDialogOpen(false);
    setEditingModelId(null);
    setModelName('');
    setApiKey('');
    setProvider('');
    setBaseURL('');
    setIsDefault(false);
  }, []);

  const openAddDialog = useCallback(() => {
    setEditingModelId(null);
    setModelName('');
    setApiKey('');
    setIsDefault(modelsList.length === 0);
    applyType(activeType);
    setAddDialogOpen(true);
  }, [modelsList.length, activeType, applyType]);

  const openEditDialog = useCallback((model: ModelEntry) => {
    setEditingModelId(model.id);
    setProvider(model.provider);
    setModelName(model.model_name);
    setApiKey('');
    setBaseURL(model.base_url || getProviderBaseUrl(
      providers.find((p) => p.id === model.provider),
      model.model_type as ModelType,
    ));
    setFormType(model.model_type as ModelType);
    setIsDefault(model.is_default === 1);
    setAddDialogOpen(true);
  }, [providers]);

  const handleProviderChange = useCallback((newProvider: string) => {
    setProvider(newProvider);
    const entry = availableProviders.find((p) => p.id === newProvider);
    setBaseURL(getProviderBaseUrl(entry, formType));
  }, [availableProviders, formType]);

  const handleModelSuggestionPick = useCallback((name: string) => {
    setModelName(name);
    setShowSuggestions(false);
  }, []);

  const handleResetBaseURL = useCallback(() => {
    setBaseURL(defaultBaseUrl);
  }, [defaultBaseUrl]);

  const handleSubmit = useCallback(() => {
    if (!modelName.trim()) return;
    if (!editingModelId && !apiKey.trim()) return;

    const payload = {
      provider,
      model_name: modelName.trim(),
      model_type: formType,
      base_url: baseURL || null,
      is_default: isDefault ? 1 : 0,
    };

    if (editingModelId) {
      const patchData: Record<string, unknown> = { ...payload };
      if (apiKey.trim()) patchData.api_key = apiKey.trim();
      editMutation.mutate({ id: editingModelId, data: patchData });
    } else {
      addMutation.mutate({ ...payload, api_key: apiKey.trim() });
    }
  }, [editingModelId, modelName, apiKey, provider, formType, baseURL, isDefault, addMutation, editMutation]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTargetId) deleteMutation.mutate(deleteTargetId);
  }, [deleteTargetId, deleteMutation]);

  /** 渲染指定类型的模型列表 */
  const renderModelList = (type: ModelType) => {
    const typed = modelsList.filter((m) => m.model_type === type);
    if (typed.length === 0) {
      return (
        <Empty>
          <EmptyTitle>{t('llm.typeEmptyTitle', { type: t(`llm.types.${type}`) })}</EmptyTitle>
          <EmptyDescription>{t('llm.typeEmptyDescription')}</EmptyDescription>
        </Empty>
      );
    }
    return (
      <div className="space-y-3">
        {typed.map((m) => (
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
                    <p className="font-medium truncate">{m.provider} / {m.model_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      API Key: {m.api_key.slice(0, 8)}...
                      {m.base_url ? ` \u00b7 ${m.base_url}` : ''}
                    </p>
                  </div>
                </div>
                {isAdmin && (
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
                    {m.is_default === 1 && <Badge variant="default">{t('llm.defaultBadge')}</Badge>}
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
                      onOpenChange={(open) => { if (!open) setDeleteTargetId(null); }}
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
                          <Button variant="outline" onClick={() => setDeleteTargetId(null)}>
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
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  if (isLoading) {
    return (
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
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('llm.title')}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t('llm.description')}</p>
        </div>
        {isAdmin && (
          <Dialog open={addDialogOpen} onOpenChange={(open) => { if (!open) resetFormDialog(); }}>
            <DialogTrigger asChild>
              <Button onClick={openAddDialog}>
                <Plus className="size-4" />
                {t('llm.addModel')}
              </Button>
            </DialogTrigger>
            <AddModelDialog
              isEdit={!!editingModelId}
              modelType={formType}
              onModelTypeChange={applyType}
              providers={availableProviders}
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
              currentSuggestions={currentSuggestions}
              isBaseURLModified={isBaseURLModified}
              onResetBaseURL={handleResetBaseURL}
              onModelSuggestionPick={handleModelSuggestionPick}
              isDefault={isDefault}
              onIsDefaultChange={setIsDefault}
              onSubmit={handleSubmit}
              isPending={addMutation.isPending || editMutation.isPending}
            />
          </Dialog>
        )}
      </div>

      <Tabs value={activeType} onValueChange={(v) => setActiveType(v as ModelType)}>
        <TabsList>
          {MODEL_TYPES.map((mt) => (
            <TabsTrigger key={mt.value} value={mt.value}>
              {t(mt.i18nKey)}
            </TabsTrigger>
          ))}
        </TabsList>
        {MODEL_TYPES.map((mt) => (
          <TabsContent key={mt.value} value={mt.value}>
            {renderModelList(mt.value)}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
