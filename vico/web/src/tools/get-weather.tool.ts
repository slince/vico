/**
 * 天气查询工具定义。
 *
 * 对应服务端 server/src/agent/tools/weather-tool.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 */
import {z} from 'zod/v4';
import {WeatherToolRenderer} from './ToolUIs/weather-ui';

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

export const getWeatherTool = {
  description: 'Get current weather for a location',
  parameters: getWeatherSchema,
  render: WeatherToolRenderer,
  display: 'standalone' as const,
};
