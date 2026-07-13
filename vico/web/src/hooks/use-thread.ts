import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Thread } from '@/types/models';

/**
 * 根据 threadId 查询会话详情，仅在 threadId 存在时启用查询。
 */
export function useThread(threadId?: string) {
  return useQuery({
    queryKey: ['conversation', threadId],
    queryFn: () => api<Thread>(`/conversations/${threadId}`),
    enabled: !!threadId,
  });
}
