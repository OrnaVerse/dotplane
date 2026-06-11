import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { ServerHealthSummary, ServerRecord } from '../lib/types'

export const SERVERS_KEY = ['servers'] as const
export const SERVER_HEALTH_KEY = ['servers', 'health'] as const

export function useServers() {
  return useQuery({
    queryKey: SERVERS_KEY,
    queryFn: () => apiFetch<ServerRecord[]>('/servers'),
    refetchInterval: 30_000,
  })
}

export function useServerHealth() {
  return useQuery({
    queryKey: SERVER_HEALTH_KEY,
    queryFn: () => apiFetch<ServerHealthSummary>('/servers/health'),
    refetchInterval: 30_000,
  })
}

export function useServer(id: string | undefined) {
  return useQuery({
    queryKey: [...SERVERS_KEY, id],
    queryFn: () => apiFetch<ServerRecord>(`/servers/${id}`),
    enabled: Boolean(id),
  })
}

export function useCreateServer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: { displayName: string; hostname: string }) =>
      apiFetch<{ id: string; installCommand: string; registrationToken: string }>('/servers', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SERVERS_KEY })
      void queryClient.invalidateQueries({ queryKey: SERVER_HEALTH_KEY })
    },
  })
}

export function useDeleteServer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiFetch(`/servers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SERVERS_KEY })
      void queryClient.invalidateQueries({ queryKey: SERVER_HEALTH_KEY })
    },
  })
}
