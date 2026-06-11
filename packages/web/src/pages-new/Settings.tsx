import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useCallback, useState } from 'react';
import { Plus, Trash2, Check, RotateCcw } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';

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
 * LLM 模型设置页面
 * 管理 AI 模型提供商的 API Key 和模型配置，支持增删及设置默认模型
 */
export default function Settings() {
  const queryClient = useQueryClient();

  // ---------- 对话框状态 ----------
  /** 控制添加模型对话框的开关 */
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  /** 待删除的模型 ID（为空表示未确认删除） */
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // ---------- 表单状态 ----------
  /** 当前选中的模型提供商 */
  const [provider, setProvider] = useState('openai');
  /** 用户输入的模型名称 */
  const [modelName, setModelName] = useState('');
  /** 用户输入的 API Key */
  const [apiKey, setApiKey] = useState('');
  /** 用户输入的 Base URL（默认跟随 provider 预设） */
  const [baseURL, setBaseURL] = useState(PROVIDER_PRESETS.openai.baseURL);
  /** 是否显示模型名称建议下拉 */
  const [showSuggestions, setShowSuggestions] = useState(false);

  // ---------- 数据获取 ----------
  const { data: models, isLoading } = useQuery<ModelEntry[]>({
    queryKey: ['models'],
    queryFn: () => api('/models'),
  });

  // ---------- 变更操作 ----------

  /**
   * 添加模型变更
   * 成功后刷新列表并重置表单状态
   */
  const addMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api('/models', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      // 重置对话框与表单状态
      setAddDialogOpen(false);
      setModelName('');
      setApiKey('');
      setProvider('openai');
      setBaseURL(PROVIDER_PRESETS.openai.baseURL);
    },
  });

  /**
   * 删除模型变更
   * 成功后刷新列表并清空待删除目标
   */
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/models/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
      setDeleteTargetId(null);
    },
  });

  /**
   * 设为默认模型变更
   * 成功后刷新列表
   */
  const setDefaultMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/models/${id}`, { method: 'PATCH', body: JSON.stringify({ is_default: 1 }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] });
    },
  });

  // ---------- 事件处理 ----------

  /**
   * 切换提供商时同步更新 baseURL 为对应预设值
   * @param newProvider - 新选中的提供商键名
   */
  const handleProviderChange = useCallback((newProvider: string) => {
    setProvider(newProvider);
    const preset = PROVIDER_PRESETS[newProvider];
    if (preset) {
      setBaseURL(preset.baseURL);
    }
  }, []);

  /**
   * 选择模型名称建议
   * @param name - 建议的模型名称
   */
  const handleModelSuggestionPick = useCallback((name: string) => {
    setModelName(name);
    setShowSuggestions(false);
  }, []);

  /**
   * 将 baseURL 重置为当前提供商的默认值
   */
  const handleResetBaseURL = useCallback(() => {
    const preset = PROVIDER_PRESETS[provider];
    if (preset) {
      setBaseURL(preset.baseURL);
    }
  }, [provider]);

  /**
   * 提交添加模型表单
   */
  const handleAddModel = useCallback(() => {
    if (!modelName.trim() || !apiKey.trim()) return;
    // 首个模型自动设为默认
    const isDefault = modelsList.length === 0 ? 1 : 0;
    addMutation.mutate({
      provider,
      model_name: modelName.trim(),
      api_key_encrypted: apiKey.trim(),
      base_url: baseURL || null,
      is_default: isDefault,
    });
  }, [modelName, apiKey, provider, baseURL, addMutation, models]);

  /**
   * 确认删除指定的模型
   */
  const handleDeleteConfirm = useCallback(() => {
    if (deleteTargetId) {
      deleteMutation.mutate(deleteTargetId);
    }
  }, [deleteTargetId, deleteMutation]);

  // ---------- 派生数据 ----------
  const modelsList = models || [];
  /** 当前选中提供商的预设模型列表 */
  const currentPresetModels = PROVIDER_PRESETS[provider]?.models || [];
  /** 当前 baseURL 与预设是否一致（用于判断是否显示重置按钮） */
  const isBaseURLModified = PROVIDER_PRESETS[provider]?.baseURL && baseURL !== PROVIDER_PRESETS[provider].baseURL;

  // ---------- 加载态 ----------
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-9 w-28" />
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
      {/* 页面标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">LLM 模型设置</h2>
          <p className="text-sm text-muted-foreground mt-1">
            配置 AI 模型提供商的 API Key 和模型，至少添加一个模型后即可使用
          </p>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" />
              添加模型
            </Button>
          </DialogTrigger>
          {/* 添加模型对话框 */}
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>添加 LLM 模型</DialogTitle>
              <DialogDescription>
                选择一个模型提供商并填写对应的 API Key 和模型名称
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* 提供商 + 模型名称行 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="model-provider">提供商</Label>
                  <Select value={provider} onValueChange={handleProviderChange}>
                    <SelectTrigger id="model-provider" className="w-full">
                      <SelectValue placeholder="选择提供商" />
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
                  <Label htmlFor="model-name">模型名称</Label>
                  <Input
                    id="model-name"
                    value={modelName}
                    onChange={(e) => {
                      setModelName(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    placeholder={`e.g. ${currentPresetModels[0] || 'model-name'}`}
                  />
                  {/* 模型名称建议下拉列表 */}
                  {showSuggestions && currentPresetModels.length > 0 && (
                    <div className="absolute z-10 top-full mt-0.5 w-full bg-popover border rounded-md shadow-lg py-1">
                      {currentPresetModels.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onMouseDown={() => handleModelSuggestionPick(m)}
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
                <Label htmlFor="model-apikey">API Key</Label>
                <Input
                  id="model-apikey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                />
              </div>

              {/* Base URL 输入 */}
              <div className="space-y-2">
                <Label htmlFor="model-baseurl">Base URL</Label>
                <div className="flex gap-1.5">
                  <Input
                    id="model-baseurl"
                    value={baseURL}
                    onChange={(e) => setBaseURL(e.target.value)}
                    placeholder={PROVIDER_PRESETS[provider]?.baseURL || 'https://api.example.com/v1'}
                    className="flex-1"
                  />
                  {/* 仅在 Base URL 被修改后显示重置按钮 */}
                  {isBaseURLModified && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={handleResetBaseURL}
                      title="重置为默认 URL"
                    >
                      <RotateCcw className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter showCloseButton>
              <Button
                onClick={handleAddModel}
                disabled={!modelName.trim() || !apiKey.trim() || addMutation.isPending}
              >
                {addMutation.isPending ? '添加中...' : '添加'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* 空状态 */}
      {modelsList.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>暂无模型配置</EmptyTitle>
            <EmptyDescription>
              请添加至少一个 LLM 模型以启用 AI 对话功能
            </EmptyDescription>
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
                    {/* 默认模型标识：绿色对勾图标 */}
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
                        {m.base_url ? ` · ${m.base_url}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* 非默认模型：显示"设为默认"按钮 */}
                    {m.is_default !== 1 && (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => setDefaultMutation.mutate(m.id)}
                        disabled={setDefaultMutation.isPending}
                      >
                        设为默认
                      </Button>
                    )}
                    {/* 默认标签 */}
                    <Badge variant={m.is_default === 1 ? 'default' : 'secondary'}>
                      {m.is_default === 1 ? '默认' : ''}
                    </Badge>
                    {/* 删除按钮 --- 使用 AlertDialog 确认 */}
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
                          <AlertDialogTitle>确认删除</AlertDialogTitle>
                          <AlertDialogDescription>
                            确定要删除模型「{m.provider} / {m.model_name}」吗？此操作不可撤销。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => setDeleteTargetId(null)}
                          >
                            取消
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={handleDeleteConfirm}
                            disabled={deleteMutation.isPending}
                          >
                            {deleteMutation.isPending ? '删除中...' : '确认删除'}
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
  );
}
