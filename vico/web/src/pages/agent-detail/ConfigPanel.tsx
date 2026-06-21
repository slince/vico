import { useTranslation } from 'react-i18next';
import type { UseFormRegister } from 'react-hook-form';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';

import type { Agent, Model } from './types';

interface FormFields {
  system_prompt: string;
  max_tokens: number;
}

export interface ConfigPanelProps {
  agent: Agent;
  modelsList: Model[];
  register: UseFormRegister<FormFields>;
  onUpdate: (data: Record<string, unknown>) => void;
}

/**
 * Agent 配置面板
 *
 * 包含 System Prompt、模型选择、参数配置三个区块。
 * 所有修改即时通过 onUpdate 回调提交。
 */
export default function ConfigPanel({
  agent,
  modelsList,
  register,
  onUpdate,
}: ConfigPanelProps) {
  const { t } = useTranslation('agents');
  const a = agent;

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('systemPrompt')}</CardTitle>
          <CardDescription>{t('systemPromptDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Label htmlFor="system-prompt" className="sr-only">
            {t('systemPrompt')}
          </Label>
          <Textarea
            id="system-prompt"
            {...register('system_prompt')}
            className="min-h-40 font-mono text-sm"
            placeholder={t('systemPromptPlaceholder')}
            disabled={a.is_default === 1}
          />
          {a.is_default === 1 && (
            <p className="text-xs text-muted-foreground mt-2">
              {t('defaultAgentPromptLocked')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('modelSelect')}</CardTitle>
          <CardDescription>{t('modelSelectDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={a.model_id || ''}
            onValueChange={(value) => onUpdate({ model_id: value })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('modelSelectPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {modelsList.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.provider} / {m.model_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {modelsList.length === 0 && (
            <p className="text-sm text-muted-foreground mt-2">
              {t('noModelAvailable')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('paramConfig')}</CardTitle>
          <CardDescription>{t('paramConfigDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('temperature')}</Label>
              <span className="text-sm text-muted-foreground tabular-nums">
                {a.temperature ?? 0.7}
              </span>
            </div>
            <Slider
              value={[a.temperature ?? 0.7]}
              onValueCommit={([v]) => onUpdate({ temperature: v })}
              min={0}
              max={2}
              step={0.1}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0 — {t('temperatureExact')}</span>
              <span>2 — {t('temperatureCreative')}</span>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="max-tokens">{t('maxTokens')}</Label>
            <Input
              id="max-tokens"
              type="number"
              {...register('max_tokens', { valueAsNumber: true })}
              min={1}
              max={128000}
              className="max-w-48"
            />
            <p className="text-xs text-muted-foreground">
              {t('maxTokensDesc')}
            </p>
          </div>
          <Separator />

          <div className="space-y-2">
            <Label>{t('ragMode')}</Label>
            <Select
              value={a.rag_mode || 'auto'}
              onValueChange={(value) => onUpdate({ rag_mode: value })}
            >
              <SelectTrigger className="max-w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('ragModeAuto')}</SelectItem>
                <SelectItem value="disabled">{t('ragModeDisabled')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('ragModeDesc')}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
