// @vico/boot - 聊天模型配置段

import { z } from 'zod';

/** 聊天模型全局默认上下文窗口 */
export const modelSchema = z.object({
  context_window: z.number().optional(),
});
