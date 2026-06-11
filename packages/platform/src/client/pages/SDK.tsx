import {
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { IconCheck, IconX } from '@tabler/icons-react'
import { useState } from 'react'
import { apiFetch, apiPostSse } from '../lib/api'
import type { SdkMatrix } from '../lib/types'

export function SDK() {
  const queryClient = useQueryClient()
  const [installLog, setInstallLog] = useState<string[]>([])
  const [installing, setInstalling] = useState(false)

  const { data: matrix, isLoading } = useQuery({
    queryKey: ['sdk', 'matrix'],
    queryFn: () => apiFetch<SdkMatrix>('/sdk/matrix'),
    refetchInterval: 30_000,
  })

  const syncAll = useMutation({
    mutationFn: () => apiFetch('/sdk/sync-all', { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sdk'] })
      notifications.show({ message: 'SDK sync started', color: 'blue' })
    },
  })

  const cellStatus = (serverId: string, version: string): boolean => {
    const cell = matrix?.cells.find((c) => c.serverId === serverId && c.sdkVersion === version)
    return cell?.installed ?? false
  }

  const installSdk = async (serverId: string, version: string) => {
    setInstalling(true)
    setInstallLog([])
    try {
      await apiPostSse(
        '/sdk/install',
        { serverId, version },
        (event) => {
          const e = event as { message?: string; line?: string }
          const line = e.message ?? e.line
          if (line) setInstallLog((prev) => [...prev, line])
        },
      )
      void queryClient.invalidateQueries({ queryKey: ['sdk'] })
      notifications.show({ title: 'Installed', message: `${version} on server`, color: 'green' })
    } catch (err) {
      notifications.show({
        title: 'Install failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        color: 'red',
      })
    } finally {
      setInstalling(false)
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>SDK Matrix</Title>
        <Group>
          <Button variant="light" loading={syncAll.isPending} onClick={() => void syncAll.mutate()}>
            Sync All
          </Button>
          <Button
            loading={installing}
            onClick={() => {
              const version = matrix?.versions[0]
              if (version && matrix?.servers[0]) {
                void installSdk(matrix.servers[0].id, version)
              }
            }}
          >
            Install latest on all
          </Button>
        </Group>
      </Group>

      {isLoading ? (
        <Text c="dimmed">Loading matrix…</Text>
      ) : matrix ? (
        <ScrollArea>
          <Table withTableBorder striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Version</Table.Th>
                {matrix.servers.map((s) => (
                  <Table.Th key={s.id}>{s.displayName}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {matrix.versions.map((version) => (
                <Table.Tr key={version}>
                  <Table.Td>
                    <Text fw={500} ff="monospace">
                      {version}
                    </Text>
                  </Table.Td>
                  {matrix.servers.map((server) => {
                    const installed = cellStatus(server.id, version)
                    return (
                      <Table.Td key={server.id}>
                        <Button
                          variant="subtle"
                          size="compact-sm"
                          color={installed ? 'green' : 'red'}
                          leftSection={installed ? <IconCheck size={14} /> : <IconX size={14} />}
                          loading={installing}
                          onClick={() => !installed && void installSdk(server.id, version)}
                        >
                          {installed ? 'Installed' : 'Install'}
                        </Button>
                      </Table.Td>
                    )
                  })}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      ) : null}

      {installLog.length > 0 && (
        <Paper p="md" withBorder>
          <Text size="sm" fw={500} mb="xs">
            Install log
          </Text>
          <ScrollArea h={160}>
            <Stack gap={2}>
              {installLog.map((line, i) => (
                <Text key={i} size="xs" ff="monospace" c="dimmed">
                  {line}
                </Text>
              ))}
            </Stack>
          </ScrollArea>
        </Paper>
      )}
    </Stack>
  )
}
