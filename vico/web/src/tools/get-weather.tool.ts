/**
 * 天气查询工具定义。
 *
 * 对应服务端 server/src/agent/tools/weather-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 */
import {z} from 'zod/v4';
import type {ToolkitDefinitionEntry} from '@assistant-ui/react';
import {Cloud} from 'lucide-react';
import {WeatherToolRenderer} from './ToolUIs/weather-ui';
import type {ToolRunActivitySummary} from './tool-summary';

const getWeatherSchema = z.object({
  location: z.string().describe('City name'),
});

const getWeatherOutputSchema = z.object({
  temperature: z.number(),
  feelsLike: z.number(),
  humidity: z.number(),
  windSpeed: z.number(),
  windGust: z.number(),
  conditions: z.string(),
  location: z.string(),
});

export type GetWeatherArgs = z.infer<typeof getWeatherSchema>;
export type GetWeatherResult = z.infer<typeof getWeatherOutputSchema>;

/**
 * get-weather 的 RunActivity 摘要 — 关键参数是查询城市。
 */
export function summarizeGetWeather(args: GetWeatherArgs): ToolRunActivitySummary {
  return {
    icon: Cloud,
    description: args.location,
  };
}

export const getWeatherTool: ToolkitDefinitionEntry<GetWeatherArgs, GetWeatherResult> = {
  description: 'Get current weather for a location',
  parameters: getWeatherSchema,
  render: WeatherToolRenderer,
  display: 'standalone' as const,
};
