/**
 * 天气工具 UI — 将 get-weather 工具调用渲染为天气信息卡片。
 *
 * 状态机：requires-action → running → complete（展示结果）
 * approval.approved === false → 审批拒绝 → 展示已拒绝状态
 * isError / incomplete → 错误提示
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import {Cloud, Droplets, MapPin, Thermometer, Wind, Check, X} from 'lucide-react';
import {ToolApprovalCard} from '@/components/assistant-ui/tool-approval-card';
import type {GetWeatherArgs, GetWeatherResult} from '../get-weather.tool';

export const WeatherToolRenderer: ToolCallMessagePartComponent<GetWeatherArgs, GetWeatherResult> = ({ status, args, result, isError, approval, respondToApproval }) => {
  const {t} = useTranslation('assistant');

  // 审批已裁决（被拒绝或已批准且有结果）
  if (approval?.approved !== undefined || result !== undefined) {
    const isApproved = approval?.approved ?? true;

    // 审批拒绝 → 展示已拒绝状态
    if (!isApproved) {
      return (
        <div className="border border-destructive/30 rounded-lg p-4 my-2 bg-destructive/5">
          <div className="flex items-center gap-2">
            <X size={16} className="text-destructive" />
            <span className="text-sm text-destructive">{t('tool.weather.rejected')}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            <MapPin size={14} className="text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{String(args?.location ?? t('tool.weather.unknown'))}</span>
          </div>
        </div>
      );
    }

    // 审批通过 + 完成 → 展示结果
    if (status.type === 'complete' && result) {
      return (
        <div className="border rounded-lg p-4 my-2 bg-gradient-to-br from-blue-50 to-sky-50 dark:from-blue-950/30 dark:to-sky-950/20">
          {/* 位置 + 天气状况 */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <MapPin size={14} className="text-muted-foreground" />
              <span className="text-sm font-medium">{result.location}</span>
            </div>
            <span className="text-sm text-muted-foreground">{result.conditions}</span>
          </div>

          {/* 温度 */}
          <div className="flex items-baseline gap-2 mb-3">
            <Thermometer size={18} className="text-orange-500" />
            <span className="text-3xl font-bold">{Math.round(result.temperature)}&deg;C</span>
            <span className="text-sm text-muted-foreground">
              {t('tool.weather.feelsLike', {temp: Math.round(result.feelsLike)})}
            </span>
          </div>

          {/* 详细信息 */}
          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Droplets size={12} />
              <span>{t('tool.weather.humidity', {value: result.humidity})}</span>
            </div>
            <div className="flex items-center gap-1">
              <Wind size={12} />
              <span>{result.windSpeed} km/h</span>
            </div>
            <div className="flex items-center gap-1">
              <Wind size={12} />
              <span>{t('tool.weather.gust', {value: result.windGust})}</span>
            </div>
          </div>
        </div>
      );
    }
  }

  // 需要审批
  if (status.type === 'requires-action') {
    return (
      <ToolApprovalCard
        toolName={t('tool.weather.title')}
        title={t('tool.weather.approvalTitle')}
        description={t('tool.weather.location', {location: String(args?.location ?? t('tool.weather.unknown'))})}
        respondToApproval={respondToApproval}
      />
    );
  }

  // 执行中
  if (status.type === 'running') {
    return (
      <div className="border rounded-lg p-4 my-2 bg-muted/30 animate-pulse">
        <div className="flex items-center gap-2">
          <Cloud size={18} className="text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{t('tool.weather.querying')}</span>
        </div>
      </div>
    );
  }

  // 错误
  if (isError || status.type === 'incomplete') {
    return (
      <div className="border border-destructive/30 rounded-lg p-4 my-2 bg-destructive/5">
        <span className="text-sm text-destructive">{t('tool.weather.failed')}</span>
      </div>
    );
  }

  return null;
};
