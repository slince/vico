import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useState, useCallback } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';

const PROVIDER_PRESETS: Record<string, { baseURL: string; models: string[] }> = {
  openai: { baseURL: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'] },
  anthropic: { baseURL: 'https://api.anthropic.com/v1', models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'] },
  deepseek: { baseURL: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-coder'] },
  qwen: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  custom: { baseURL: '', models: [] },
};

export default function Settings() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [provider, setProvider] = useState('openai');
  const [modelName, setModelName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState(PROVIDER_PRESETS.openai.baseURL);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleProviderChange = useCallback((provider: string) => {
    setProvider(provider);
    const preset = PROVIDER_PRESETS[provider];
    if (preset) {
      setBaseURL(preset.baseURL);
    }
  }, []);

  const { data: models, isLoading } = useQuery({
    queryKey: ['models'],
    queryFn: () => api('/models'),
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => api('/models', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['models'] }); setShowAdd(false); setModelName(''); setApiKey(''); setBaseURL(PROVIDER_PRESETS.openai.baseURL); setProvider('openai'); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/models/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => api(`/models/${id}`, { method: 'PATCH', body: JSON.stringify({ is_default: 1 }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>;

  const modelsList = (models as any[]) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">LLM 模型设置</h2>
          <p className="text-sm text-muted-foreground mt-1">配置 AI 模型提供商的 API Key 和模型</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
          <Plus size={16} /> 添加模型
        </button>
      </div>

      {showAdd && (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <h3 className="font-medium">添加 LLM 模型</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm">提供商</label>
              <select value={provider} onChange={(e) => handleProviderChange(e.target.value)} className="w-full mt-1 px-3 py-2 border rounded-md text-sm">
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="deepseek">DeepSeek</option>
                <option value="qwen">通义千问</option>
                <option value="custom">自定义</option>
              </select>
            </div>
            <div className="relative">
              <label className="text-sm">模型名称</label>
              <input
                type="text" value={modelName} onChange={(e) => { setModelName(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)} onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                placeholder="e.g. gpt-4o"
                className="w-full mt-1 px-3 py-2 border rounded-md text-sm"
              />
              {showSuggestions && PROVIDER_PRESETS[provider]?.models.length > 0 && (
                <div className="absolute z-10 top-full mt-0.5 w-full bg-popover border rounded-md shadow-lg py-1">
                  {PROVIDER_PRESETS[provider].models.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onMouseDown={() => { setModelName(m); setShowSuggestions(false); }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="text-sm">API Key</label>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className="w-full mt-1 px-3 py-2 border rounded-md text-sm" />
          </div>
          <div>
            <label className="text-sm">Base URL</label>
            <div className="flex gap-1 mt-1">
              <input
                type="text" value={baseURL} onChange={(e) => setBaseURL(e.target.value)}
                placeholder={PROVIDER_PRESETS[provider]?.baseURL || 'https://api.example.com/v1'}
                className="flex-1 px-3 py-2 border rounded-md text-sm"
              />
              {PROVIDER_PRESETS[provider]?.baseURL && baseURL !== PROVIDER_PRESETS[provider].baseURL && (
                <button
                  type="button"
                  onClick={() => setBaseURL(PROVIDER_PRESETS[provider].baseURL)}
                  className="px-2 py-2 text-xs text-muted-foreground hover:text-foreground border rounded-md"
                  title="重置为默认 URL"
                >
                  重置
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => addMutation.mutate({ provider, model_name: modelName, api_key_encrypted: apiKey, base_url: baseURL || null, is_default: modelsList.length === 0 ? 1 : 0 })}
              disabled={!modelName || !apiKey}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
            >
              添加
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 border rounded-md text-sm">取消</button>
          </div>
        </div>
      )}

      {modelsList.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p>暂无模型配置，请添加至少一个 LLM 模型</p>
        </div>
      ) : (
        <div className="space-y-3">
          {modelsList.map((m: any) => (
            <div key={m.id} className="bg-card border rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {m.is_default === 1 && <Check size={16} className="text-green-500" />}
                <div>
                  <p className="font-medium">{m.provider} / {m.model_name}</p>
                  <p className="text-xs text-muted-foreground">
                    API Key: {m.api_key_encrypted.slice(0, 8)}...{m.base_url ? ` · ${m.base_url}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {m.is_default !== 1 && (
                  <button onClick={() => setDefaultMutation.mutate(m.id)} className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent">
                    设为默认
                  </button>
                )}
                <span className={`text-xs px-2 py-0.5 rounded-full ${m.is_default === 1 ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>
                  {m.is_default === 1 ? '默认' : ''}
                </span>
                <button onClick={() => { if (confirm('确认删除？')) deleteMutation.mutate(m.id); }} className="p-1.5 text-muted-foreground hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
