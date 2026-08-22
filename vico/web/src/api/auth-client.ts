import { createAuthClient } from 'better-auth/react';
import { usernameClient } from 'better-auth/client/plugins';

/** better-auth 客户端 — 由 Vite 代理到后端 :3001，cookie 自动携带 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [
    usernameClient(),
  ],
  fetchOptions: {
    credentials: 'include',
  },
});
