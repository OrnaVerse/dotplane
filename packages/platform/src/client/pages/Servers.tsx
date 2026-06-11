import {
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Loader,
  ActionIcon,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconCopy, IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { MemoryBar } from '../components/shared/MemoryBar'
import { StatusDot, statusLabel } from '../components/shared/StatusDot'
import { useCreateServer, useServers } from '../hooks/useServers'
import { ApiError } from '../lib/api'

export function Servers() {
  const { data: servers = [], isLoading } = useServers()
  const createServer = useCreateServer()
  const [opened, { open, close }] = useDisclosure(false)
  const [installInfo, setInstallInfo] = useState<{ command: string; serverId: string } | null>(null)

  const form = useForm({
    initialValues: { displayName: '', hostname: '' },
    validate: {
      displayName: (v) => (v.trim() ? null : 'Required'),
      hostname: (v) => (v.trim() ? null : 'Required'),
    },
  })

  const handleCreate = form.onSubmit(async (values) => {
    try {
      const result = await createServer.mutateAsync(values)
      setInstallInfo({ command: result.installCommand, serverId: result.id })
      close()
      form.reset()
      notifications.show({ title: 'Server registered', message: 'Run the install command on the host', color: 'blue' })
    } catch (err) {
      notifications.show({
        title: 'Failed',
        message: err instanceof ApiError ? err.message : 'Could not add server',
        color: 'red',
      })
    }
  })

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Servers</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={open}>
          Add Server
        </Button>
      </Group>

      {isLoading ? (
        <Text c="dimmed">Loading…</Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Instances</Table.Th>
              <Table.Th>Memory</Table.Th>
              <Table.Th>CPU</Table.Th>
              <Table.Th>Last Seen</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {servers.map((server) => (
              <Table.Tr key={server.id}>
                <Table.Td>
                  <Stack gap={0}>
                    <Text fw={500}>{server.displayName}</Text>
                    <Text size="xs" c="dimmed">
                      {server.hostname}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <StatusDot status={server.status === 'online' ? 'healthy' : server.status === 'degraded' ? 'degraded' : 'down'} />
                    <Badge color={server.status === 'online' ? 'green' : server.status === 'pending' ? 'blue' : 'gray'} variant="light">
                      {statusLabel(server.status)}
                    </Badge>
                  </Group>
                </Table.Td>
                <Table.Td>{server.instanceCount ?? 0}</Table.Td>
                <Table.Td style={{ minWidth: 140 }}>
                  {server.totalMemory ? (
                    <MemoryBar used={server.memoryUsedBytes} max={server.totalMemory} size="xs" />
                  ) : (
                    '—'
                  )}
                </Table.Td>
                <Table.Td>{server.cpuPercent != null ? `${Math.round(server.cpuPercent)}%` : '—'}</Table.Td>
                <Table.Td>{server.lastSeen ? new Date(server.lastSeen).toLocaleString() : '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={opened} onClose={close} title="Add Server">
        <form onSubmit={handleCreate}>
          <Stack gap="md">
            <TextInput label="Display Name" {...form.getInputProps('displayName')} />
            <TextInput label="Hostname / IP" {...form.getInputProps('hostname')} />
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" loading={createServer.isPending}>
                Generate Install
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={Boolean(installInfo)} onClose={() => setInstallInfo(null)} title="Agent Install" size="lg">
        {installInfo && (
          <Stack gap="md">
            <Text size="sm">Run this command on the new server as root:</Text>
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <Code block style={{ flex: 1, wordBreak: 'break-all' }}>
                {installInfo.command}
              </Code>
              <CopyButton value={installInfo.command}>
                {({ copied, copy }) => (
                  <ActionIcon variant="light" onClick={copy} aria-label="Copy">
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                )}
              </CopyButton>
            </Group>
            <Group gap="sm">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                Waiting for agent to connect…
              </Text>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}
