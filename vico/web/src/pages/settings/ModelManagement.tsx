// 1. React
import { useCallback, useState } from 'react';

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
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';

// 5. 页面子组件
import AddModelDialog from './AddModelDialog';
import { PROVIDER_PRESETS } from './providers';

/** LLM 模型数据结构 */
interface ModelEntry {
  id: string;
  provider: string;
  model_name: string;
  api_key: string;
  base_url: string | null;
  is_default: number;
}

/**
 * 模型管理 section：列表 + 增/改/删/设默认。
 * 非 admin（isAdmin=false）隐藏所有写操作按钮，列表只读。
 */
export default function ModelManagement({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const [provider, setProvider] = useState('openai');
  const [modelName, setModelName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState(PROVIDER_PRESETS.openai.baseURL);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  const { data: models, isLoading } = useQuery<ModelEntry[]>({
    queryKey: ['models'],
    queryFn: () => api('/models'),
  });

  const modelsList = models || [];
  const currentPresetModels = PROVIDER_PRESETS[provider]?.models || [];
  const isBaseURLModified = !!(PROVIDER_PRESETS[provider]?.baseURL && baseURL !== PROVIDER_PRESETS[provider].baseURL);

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

  const resetFormDialog = useCallback(() => {
    setAddDialogOpen(false);
    setEditingModelId(null);
    setModelName('');
    setApiKey('');
    setProvider('openai');
    setBaseURL(PROVIDER_PRESETS.openai.baseURL);
    setIsDefault(false);
  }, []);

  const openAddDialog = useCallback(() => {
    setEditingModelId(null);
    setModelName('');
    setApiKey('');
    setProvider('openai');
    setBaseURL(PROVIDER_PRESETS.openai.baseURL);
    setIsDefault(modelsList.length === 0);
    setAddDialogOpen(true);
  }, [modelsList.length]);

  const openEditDialog = useCallback((model: ModelEntry) => {
    setEditingModelId(model.id);
    setProvider(model.provider);
    setModelName(model.model_name);
    setApiKey('');
    setBaseURL(model.base_url || PROVIDER_PRESETS[model.provider]?.baseURL || '');
    setIsDefault(model.is_default === 1);
    setAddDialogOpen(true);
  }, []);

  const handleProviderChange = useCallback((newProvider: string) => {
    setProvider(newProvider);
    const preset = PROVIDER_PRESETS[newProvider];
    if (preset) setBaseURL(preset.baseURL);
  }, []);

  const handleModelSuggestionPick = useCallback((name: string) => {
    setModelName(name);
    setShowSuggestions(false);
  }, []);

  const handleResetBaseURL = useCallback(() => {
    const preset = PROVIDER_PRESETS[provider];
    if (preset) setBaseURL(preset.baseURL);
  }, [provider]);

  const handleSubmit = useCallback(() => {
    if (!modelName.trim()) return;
    if (!editingModelId && !apiKey.trim()) return;

    if (editingModelId) {
      const patchData: Record<string, unknown> = {
        provider,
        model_name: modelName.trim(),
        base_url: baseURL || null,
        is_default: isDefault ? 1 : 0,
      };
      if (apiKey.trim()) patchData.api_key = apiKey.trim();
      editMutation.mutate({ id: editingModelId, data: patchData });
    } else {
      addMutation.mutate({
        provider,
        model_name: modelName.trim(),
        api_key: apiKey.trim(),
        base_url: baseURL || null,
        is_default: isDefault ? 1 : 0,
      });
    }
  }, [editingModelId, modelName, apiKey, provider, baseURL, addMutation, editMutation]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTargetId) deleteMutation.mutate(deleteTargetId);
  }, [deleteTargetId, deleteMutation]);

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
        )}
      </div>

      {modelsList.length === 0 ? (
        <Empty>
          <EmptyTitle>{t('llm.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('llm.emptyDescription')}</EmptyDescription>
        </Empty>
      ) : (
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
      )}
    </div>
  );
}
