/**
 * 天气工具 UI — 将 get-weather 工具调用渲染为天气信息卡片。
 *
 * 状态机：requires-action → running → complete（展示结果）
 * isError / incomplete → 错误提示
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {Cloud, Droplets, MapPin, Thermometer, Wind} from 'lucide-react';
import {ToolApprovalCard} from '@/components/assistant-ui/tool-approval-card';
import type {GetWeatherArgs, GetWeatherResult} from '../get-weather.tool';

export const WeatherToolRenderer: ToolCallMessagePartComponent<GetWeatherArgs, GetWeatherResult> = ({ status, args, result, isError, approval, respondToApproval, addResult }) => {
  // 需要审批
  if (status.type === 'requires-action') {
    return (
      <ToolApprovalCard
        toolName="天气查询"
        title="天气查询需要确认"
        description={`查询地点：${String(args?.location ?? '未知')}`}
        respondToApproval={respondToApproval}
        addResult={addResult}
      />
    );
  }

  // 执行中
  if (status.type === 'running') {
    return (
      <div className="border rounded-lg p-4 my-2 bg-muted/30 animate-pulse">
        <div className="flex items-center gap-2">
          <Cloud size={18} className="text-muted-foreground" />
          <span className="text-sm text-muted-foreground">正在查询天气...</span>
        </div>
      </div>
    );
  }

  // 错误
  if (isError || status.type === 'incomplete') {
    return (
      <div className="border border-destructive/30 rounded-lg p-4 my-2 bg-destructive/5">
        <span className="text-sm text-destructive">天气查询失败</span>
      </div>
    );
  }

  // 最终结果
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
            体感 {Math.round(result.feelsLike)}&deg;C
          </span>
        </div>

        {/* 详细信息 */}
        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Droplets size={12} />
            <span>{result.humidity}% 湿度</span>
          </div>
          <div className="flex items-center gap-1">
            <Wind size={12} />
            <span>{result.windSpeed} km/h</span>
          </div>
          <div className="flex items-center gap-1">
            <Wind size={12} />
            <span>阵风 {result.windGust} km/h</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
