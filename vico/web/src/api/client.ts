const BASE_URL = '/api/v1';

/** 带认证的 API 请求 — 通过 session cookie 自动携带凭据 */
export async function api<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  // FormData 需要浏览器自动设置 Content-Type（含 boundary），不要覆盖
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    if (res.status === 401) {
      console.warn('[api] 收到 401，会话可能失效，暂不跳转登录页', { path, url: res.url, status: res.status });
      throw new Error('Unauthorized');
    }
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }

  return res.json();
}

