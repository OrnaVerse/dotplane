import {
  Button,
  Group,
  Modal,
  Progress,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Paper,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { StatusDot, statusLabel } from '../components/shared/StatusDot'
import { formatBytesPublic } from '../components/shared/MemoryBar'
import { useServers } from '../hooks/useServers'
import { apiFetch } from '../lib/api'
import type { PgMetrics, PgServerRecord } from '../lib/types'

export function Postgres() {
  const queryClient = useQueryClient()
  const [opened, { open, close }] = useDisclosure(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: servers = [] } = useServers()

  const { data: pgServers = [], isLoading } = useQuery({
    queryKey: ['postgres'],
    queryFn: () => apiFetch<PgServerRecord[]>('/postgres/servers'),
    refetchInterval: 30_000,
  })

  const { data: metrics } = useQuery({
    queryKey: ['postgres', selectedId, 'metrics'],
    queryFn: () => apiFetch<PgMetrics>(`/postgres/${selectedId}/metrics`),
    enabled: Boolean(selectedId),
    refetchInterval: 15_000,
  })

  const form = useForm({
    initialValues: {
      id: '',
      displayName: '',
      serverId: '',
      pgHost: 'localhost',
      pgPort: 5432,
      pgDatabase: 'postgres',
      pgUser: '',
      pgPassword: '',
    },
    validate: {
      id: (v) => (/^[a-z0-9-]+$/.test(v) ? null : 'Slug required'),
      displayName: (v) => (v.trim() ? null : 'Required'),
      serverId: (v) => (v ? null : 'Required'),
      pgUser: (v) => (v.trim() ? null : 'Required'),
    },
  })

  const createPg = useMutation({
    mutationFn: (body: typeof form.values) => apiFetch('/postgres/servers', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['postgres'] })
      notifications.show({ title: 'PostgreSQL server added', message: 'Monitoring configured', color: 'green' })
      close()
      form.reset()
    },
  })

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>PostgreSQL</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={open}>
          Add PG Server
        </Button>
      </Group>

      {isLoading ? (
        <Text c="dimmed">Loading…</Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Host</Table.Th>
              <Table.Th>Server</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Last Checked</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {pgServers.map((pg) => (
              <Table.Tr
                key={pg.id}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedId(pg.id === selectedId ? null : pg.id)}
              >
                <Table.Td fw={500}>{pg.displayName}</Table.Td>
                <Table.Td>
                  {pg.pgHost}:{pg.pgPort}/{pg.pgDatabase}
                </Table.Td>
                <Table.Td>{pg.serverName ?? pg.serverId}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <StatusDot status={pg.status === 'online' ? 'healthy' : pg.status === 'offline' ? 'down' : 'unknown'} />
                    {statusLabel(pg.status)}
                  </Group>
                </Table.Td>
                <Table.Td>{pg.lastChecked ? new Date(pg.lastChecked).toLocaleString() : '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {selectedId && metrics && (
        <Paper p="md" withBorder>
          <Title order={4} mb="md">
            Metrics
          </Title>
          <Stack gap="sm">
            <Group grow>
              <Stack gap={4}>
                <Text size="sm" c="dimmed">
                  Connections
                </Text>
                <Text fw={600}>
                  {metrics.connectionsActive ?? 0} active / {metrics.connectionsTotal ?? 0} total
                </Text>
              </Stack>
              <Stack gap={4}>
                <Text size="sm" c="dimmed">
                  Database size
                </Text>
                <Text fw={600}>{metrics.dbSizeBytes ? formatBytesPublic(metrics.dbSizeBytes) : '—'}</Text>
              </Stack>
              <Stack gap={4}>
                <Text size="sm" c="dimmed">
                  Cache hit ratio
                </Text>
                <Text fw={600}>{metrics.cacheHitRatio != null ? `${(metrics.cacheHitRatio * 100).toFixed(1)}%` : '—'}</Text>
              </Stack>
            </Group>
            {metrics.cacheHitRatio != null && (
              <Progress value={metrics.cacheHitRatio * 100} color={metrics.cacheHitRatio > 0.95 ? 'green' : 'yellow'} />
            )}
          </Stack>
        </Paper>
      )}

      <Modal opened={opened} onClose={close} title="Add PostgreSQL Server" size="lg">
        <form onSubmit={form.onSubmit((v) => void createPg.mutateAsync(v))}>
          <Stack gap="md">
            <TextInput label="ID" {...form.getInputProps('id')} />
            <TextInput label="Display Name" {...form.getInputProps('displayName')} />
            <Select
              label="Dotplane Server"
              data={servers.map((s) => ({ value: s.id, label: s.displayName }))}
              {...form.getInputProps('serverId')}
            />
            <Group grow>
              <TextInput label="PG Host" {...form.getInputProps('pgHost')} />
              <TextInput label="PG Port" type="number" {...form.getInputProps('pgPort')} />
            </Group>
            <TextInput label="Database" {...form.getInputProps('pgDatabase')} />
            <TextInput label="User" {...form.getInputProps('pgUser')} />
            <TextInput label="Password" type="password" {...form.getInputProps('pgPassword')} />
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" loading={createPg.isPending}>
                Add
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  )
}
