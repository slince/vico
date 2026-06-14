const BASE_URL = '/api/v1';

/** 带认证的 API 请求 — 通过 session cookie 自动携带凭据 */
export async function api<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }

  return res.json();
}

/** SSE 聊天流 — 通过 session cookie 自动携带凭据 */
export function streamChat(
  body: { agentId: string; threadId?: string; message: string },
  onEvent: (event: any) => void,
  onError: (err: Error) => void,
  onDone: () => void
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    credentials: 'include',
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      const err = await res.json().catch(() => ({ error: 'Chat error' }));
      onError(new Error(err.error));
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      onError(new Error('No response stream'));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        onDone();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            onEvent(event);
          } catch {}
        }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      onError(err);
    }
  });

  return controller;
}

/** SSE 团队聊天流 */
export function streamTeamChat(
  body: { teamId: string; threadId?: string; message: string },
  onEvent: (event: any) => void,
  onError: (err: Error) => void,
  onDone: () => void
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE_URL}/teams/${body.teamId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      const err = await res.json().catch(() => ({ error: 'Chat error' }));
      onError(new Error(err.error));
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) { onError(new Error('No response stream')); return; }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) { onDone(); break; }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            onEvent(event);
          } catch {}
        }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') onError(err);
  });

  return controller;
}
