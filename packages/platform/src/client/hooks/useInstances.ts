import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { InstanceRecord } from '../lib/types'

export const INSTANCES_KEY = ['instances'] as const

export function useInstances() {
  return useQuery({
    queryKey: INSTANCES_KEY,
    queryFn: () => apiFetch<InstanceRecord[]>('/instances'),
    refetchInterval: 30_000,
  })
}

export function useInstance(id: string | undefined) {
  return useQuery({
    queryKey: [...INSTANCES_KEY, id],
    queryFn: () => apiFetch<InstanceRecord>(`/instances/${id}`),
    enabled: Boolean(id),
  })
}

export function useCreateInstance() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: {
      id: string
      displayName: string
      appId: string
      serverId: string
      domain: string
      memoryTier?: string
      envVars?: Record<string, string>
      initialVersion?: string
    }) => apiFetch<{ id: string; port: number; domain: string }>('/instances', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INSTANCES_KEY })
    },
  })
}

export function useDeleteInstance() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, deleteData }: { id: string; deleteData?: boolean }) =>
      apiFetch(`/instances/${id}`, { method: 'DELETE', body: { deleteData: deleteData ?? false } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INSTANCES_KEY })
    },
  })
}

export function useRestartInstance() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/instances/${id}/restart`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INSTANCES_KEY })
    },
  })
}
