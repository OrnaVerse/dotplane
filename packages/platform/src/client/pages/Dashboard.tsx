import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Menu,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconDots, IconPlayerPlay, IconRefresh, IconTerminal2 } from '@tabler/icons-react'
import { Link } from 'react-router-dom'
import { ServerHealthBar } from '../components/shared/ServerHealthBar'
import { MemoryBar } from '../components/shared/MemoryBar'
import { StatusDot, statusLabel } from '../components/shared/StatusDot'
import { useInstances } from '../hooks/useInstances'

export function Dashboard() {
  const { data: instances = [], isLoading } = useInstances()
  const isMobile = useMediaQuery('(max-width: 48em)')

  return (
    <Stack gap="md">
      <Title order={2}>Dashboard</Title>
      <ServerHealthBar />

      {isLoading ? (
        <Text c="dimmed">Loading instances…</Text>
      ) : isMobile ? (
        <Stack gap="sm">
          {instances.map((instance) => (
            <Card key={instance.id} padding="md" radius="md" withBorder>
              <Group justify="space-between" align="flex-start" mb="sm">
                <Group gap="xs" wrap="nowrap">
                  <StatusDot status={instance.healthStatus} label={statusLabel(instance.healthStatus)} />
                  <Stack gap={0}>
                    <Text fw={600}>{instance.displayName}</Text>
                    <Text size="xs" c="dimmed">
                      {instance.domain}
                    </Text>
                  </Stack>
                </Group>
                <Badge variant="light">{instance.currentVersion ?? '—'}</Badge>
              </Group>
              <MemoryBar used={instance.memoryBytes} max={instance.memoryMax} />
              <Group mt="md" gap="xs">
                <Button size="xs" component={Link} to="/instances" leftSection={<IconPlayerPlay size={14} />}>
                  Deploy
                </Button>
                <Button size="xs" variant="default" component={Link} to={`/logs?instance=${instance.id}`} leftSection={<IconTerminal2 size={14} />}>
                  Logs
                </Button>
              </Group>
            </Card>
          ))}
        </Stack>
      ) : (
        <ScrollArea>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Domain</Table.Th>
                <Table.Th>Server</Table.Th>
                <Table.Th>Version</Table.Th>
                <Table.Th>RAM</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Last Deploy</Table.Th>
                <Table.Th w={60} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {instances.map((instance) => (
                <Table.Tr key={instance.id}>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <StatusDot status={instance.healthStatus} />
                      <Text size="sm" fw={500}>
                        {instance.displayName}
                      </Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>{instance.domain}</Table.Td>
                  <Table.Td>{instance.serverName ?? instance.serverId}</Table.Td>
                  <Table.Td>{instance.currentVersion ?? '—'}</Table.Td>
                  <Table.Td style={{ minWidth: 140 }}>
                    <MemoryBar used={instance.memoryBytes} max={instance.memoryMax} size="xs" />
                  </Table.Td>
                  <Table.Td>{statusLabel(instance.healthStatus)}</Table.Td>
                  <Table.Td>{instance.lastDeployed ? new Date(instance.lastDeployed).toLocaleString() : '—'}</Table.Td>
                  <Table.Td>
                    <Menu shadow="md" position="bottom-end">
                      <Menu.Target>
                        <ActionIcon variant="subtle" aria-label="Actions">
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item leftSection={<IconPlayerPlay size={14} />} component={Link} to="/instances">
                          Deploy
                        </Menu.Item>
                        <Menu.Item leftSection={<IconTerminal2 size={14} />} component={Link} to={`/logs?instance=${instance.id}`}>
                          Logs
                        </Menu.Item>
                        <Menu.Item leftSection={<IconRefresh size={14} />}>Restart</Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}

      {!isLoading && instances.length === 0 && (
        <Text c="dimmed">No instances yet. Add one from the Instances page.</Text>
      )}
    </Stack>
  )
}
