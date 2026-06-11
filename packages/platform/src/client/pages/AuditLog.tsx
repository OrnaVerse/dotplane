import {
  Badge,
  Drawer,
  Group,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Code,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { StatusDot } from '../components/shared/StatusDot'
import { apiFetch } from '../lib/api'
import type { AuditEntry } from '../lib/types'

export function AuditLog() {
  const [actionFilter, setActionFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<AuditEntry | null>(null)
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false)

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['audit', actionFilter],
    queryFn: () => {
      const params = actionFilter ? `?action=${actionFilter}` : ''
      return apiFetch<AuditEntry[]>(`/audit${params}`)
    },
  })

  const openDetail = (entry: AuditEntry) => {
    setSelected(entry)
    openDrawer()
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>Audit Log</Title>
        <Select
          placeholder="All actions"
          clearable
          data={[
            { value: 'login', label: 'Login' },
            { value: 'deploy', label: 'Deploy' },
            { value: 'add_instance', label: 'Add Instance' },
            { value: 'add_server', label: 'Add Server' },
          ]}
          value={actionFilter}
          onChange={setActionFilter}
          w={200}
        />
      </Group>

      {isLoading ? (
        <Text c="dimmed">Loading…</Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>User</Table.Th>
              <Table.Th>Action</Table.Th>
              <Table.Th>Target</Table.Th>
              <Table.Th>Result</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {entries.map((entry) => (
              <Table.Tr key={entry.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(entry)}>
                <Table.Td>{new Date(entry.createdAt).toLocaleString()}</Table.Td>
                <Table.Td>{entry.actorUsername ?? 'unknown'}</Table.Td>
                <Table.Td>{entry.action}</Table.Td>
                <Table.Td>
                  {entry.targetId ? `${entry.targetType ?? ''} ${entry.targetId}`.trim() : '—'}
                </Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <StatusDot
                      status={entry.success === false ? 'down' : 'healthy'}
                      label={entry.success === false ? 'Failed' : 'Success'}
                    />
                    <Badge color={entry.success === false ? 'red' : 'green'} variant="light" size="sm">
                      {entry.success === false ? 'Failed' : 'Success'}
                    </Badge>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Drawer opened={drawerOpened} onClose={closeDrawer} title="Audit Detail" position="right" size="md">
        {selected && (
          <Stack gap="md">
            <Text size="sm">
              <Text span fw={500}>
                Action:
              </Text>{' '}
              {selected.action}
            </Text>
            <Text size="sm">
              <Text span fw={500}>
                Actor:
              </Text>{' '}
              {selected.actorUsername ?? 'unknown'}
            </Text>
            <Text size="sm">
              <Text span fw={500}>
                IP:
              </Text>{' '}
              {selected.ip ?? '—'}
            </Text>
            {selected.detail && (
              <Code block>{JSON.stringify(selected.detail, null, 2)}</Code>
            )}
          </Stack>
        )}
      </Drawer>
    </Stack>
  )
}
