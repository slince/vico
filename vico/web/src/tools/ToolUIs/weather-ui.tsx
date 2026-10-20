/**
 * 天气工具 UI — 将 get-weather 工具调用渲染为天气信息卡片。
 *
 * 生命周期状态机（error/rejected/running/approval）统一由 ToolCard 承载，
 * 本渲染器只提供审批文案与完成态的结果视图（渐变大卡）。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {Cloud, Droplets, MapPin, Thermometer, Wind} from 'lucide-react';
import {ToolCard} from './tool-card';
import type {GetWeatherArgs, GetWeatherResult} from '../get-weather.tool';

/** 完成态结果视图 — 位置 + 天气状况 + 温度 + 详细指标 */
function WeatherResult({result}: {result: GetWeatherResult}) {
  const {t} = useTranslation('assistant');
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

export const WeatherToolRenderer: ToolCallMessagePartComponent<GetWeatherArgs, GetWeatherResult> = ({status, args, result, isError, approval, interrupt, resume, addResult, respondToApproval}) => {
  const {t} = useTranslation('assistant');

  return (
    <ToolCard
      title={t('tool.weather.title')}
      icon={Cloud}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      interrupt={interrupt}
      resume={resume}
      addResult={addResult}
      respondToApproval={respondToApproval}
      approvalTitle={t('tool.weather.approvalTitle')}
      approvalDescription={t('tool.weather.location', {location: String(args?.location ?? t('tool.weather.unknown'))})}
      errorLabel={t('tool.weather.failed')}
      runningLabel={t('tool.weather.querying')}
      rejectedLabel={t('tool.weather.rejected')}
      completeMode="bare"
      renderResult={(r) => <WeatherResult result={r as GetWeatherResult} />}
    />
  );
};
