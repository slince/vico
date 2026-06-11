import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';

import type { Agent, Model } from './types';

/** ConfigPanel 组件的 props */
export interface ConfigPanelProps {
  /** 当前 Agent 数据 */
  agent: Agent;
  /** 可用模型列表 */
  modelsList: Model[];
  /** 本地的 System Prompt 值（用于防抖） */
  localSystemPrompt: string | undefined;
  /** 更新本地 System Prompt（含标记用户已编辑） */
  onSystemPromptChange: (value: string) => void;
  /** 本地的 Max Tokens 值（用于防抖） */
  localMaxTokens: number | undefined;
  /** 更新本地 Max Tokens（含标记用户已编辑） */
  onMaxTokensChange: (value: string) => void;
  /** 通用更新 mutation */
  onUpdate: (data: Record<string, unknown>) => void;
}

/**
 * Agent 配置面板
 *
 * 包含三个配置区块：
 * 1. System Prompt — 多行文本编辑，300ms 防抖提交
 * 2. 模型选择 — 下拉选择可用 LLM 模型
 * 3. 参数配置 — Temperature 滑块 + Max Tokens 数字输入
 *
 * 所有修改即时通过 onUpdate 回调提交，无需保存按钮。
 *
 * @param props - 组件属性
 * @returns 配置面板 JSX 元素
 */
export default function ConfigPanel({
  agent,
  modelsList,
  localSystemPrompt,
  onSystemPromptChange,
  localMaxTokens,
  onMaxTokensChange,
  onUpdate,
}: ConfigPanelProps) {
  const a = agent;

  return (
    <div className="mt-4 space-y-4">
      {/* System Prompt 编辑 */}
      <Card>
        <CardHeader>
          <CardTitle>System Prompt</CardTitle>
          <CardDescription>
            定义 Agent 的角色、行为规范和回复风格。修改即时保存。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Label htmlFor="system-prompt" className="sr-only">
            System Prompt
          </Label>
          <Textarea
            id="system-prompt"
            value={localSystemPrompt ?? a.system_prompt ?? ''}
            onChange={(e) => onSystemPromptChange(e.target.value)}
            className="min-h-40 font-mono text-sm"
            placeholder="输入 System Prompt，定义 Agent 的行为准则..."
          />
        </CardContent>
      </Card>

      {/* 模型选择 */}
      <Card>
        <CardHeader>
          <CardTitle>模型选择</CardTitle>
          <CardDescription>
            选择 Agent 使用的大语言模型。不同模型在能力、速度和成本上有所差异。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={a.model_id || ''}
            onValueChange={(value) => onUpdate({ model_id: value })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="请选择模型..." />
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
              暂无可用模型，请先在设置中配置模型提供商
            </p>
          )}
        </CardContent>
      </Card>

      {/* 参数配置 */}
      <Card>
        <CardHeader>
          <CardTitle>参数配置</CardTitle>
          <CardDescription>
            调整生成参数以控制回复的创造性和长度。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Temperature 滑块 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Temperature</Label>
              <span className="text-sm text-muted-foreground tabular-nums">
                {a.temperature ?? 0.7}
              </span>
            </div>
            <Slider
              value={[a.temperature ?? 0.7]}
              // 仅在用户释放滑块时提交，避免拖动过程中频繁请求
              onValueCommit={([v]) => onUpdate({ temperature: v })}
              min={0}
              max={2}
              step={0.1}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0 — 精确</span>
              <span>2 — 创造</span>
            </div>
          </div>

          <Separator />

          {/* Max Tokens 数字输入 */}
          <div className="space-y-2">
            <Label htmlFor="max-tokens">Max Tokens</Label>
            <Input
              id="max-tokens"
              type="number"
              value={localMaxTokens ?? a.max_tokens ?? 4096}
              onChange={(e) => onMaxTokensChange(e.target.value)}
              min={1}
              max={128000}
              className="max-w-48"
            />
            <p className="text-xs text-muted-foreground">
              单次回复的最大 token 数，范围 1–128000
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
