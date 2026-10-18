// @vico/boot - 存储后端配置段

import { z } from 'zod';

/**
 * 存储后端配置：thread/checkpoint 支持 memory/libsql/mysql，vector 支持 memory/libsql/chroma。
 *
 * 持久化后端所需的连接由使用方注入，boot 按 `db_service` / `client_service`
 * 指定的 token 名（service id）去容器中 resolve，不自行建立连接；二者默认分别为
 * `db` / `client`，对应 VicoTokens 中声明的同名 token。
 */
export const storageSchema = z.object({
  thread: z.enum(['memory', 'libsql', 'mysql']).default('memory'),
  checkpoint: z.enum(['memory', 'libsql', 'mysql']).default('memory'),
  vector: z.enum(['memory', 'libsql', 'chroma']).default('memory'),
  db_service: z.string().default('db'),
  client_service: z.string().default('client'),
});
