import {
  Badge,
  Button,
  Group,
  Modal,
  MultiSelect,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { apiFetch } from '../lib/api'
import type { WebhookRecord } from '../lib/types'

const WEBHOOK_EVENTS = [
  'deploy.completed',
  'deploy.failed',
  'instance.health_changed',
  'instance.restart_warning',
  'agent.offline',
]

export function Webhooks() {
  const queryClient = useQueryClient()
  const [opened, { open, close }] = useDisclosure(false)

  const { data: webhooks = [], isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => apiFetch<WebhookRecord[]>('/webhooks'),
  })

  const form = useForm({
    initialValues: { name: '', url: '', events: [] as string[] },
    validate: {
      name: (v) => (v.trim() ? null : 'Required'),
      url: (v) => (v.startsWith('http') ? null : 'Valid URL required'),
      events: (v) => (v.length > 0 ? null : 'Select at least one event'),
    },
  })

  const createWebhook = useMutation({
    mutationFn: (body: typeof form.values) => apiFetch('/webhooks', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['webhooks'] })
      notifications.show({ title: 'Webhook created', message: 'Outbound webhook registered', color: 'green' })
      close()
      form.reset()
    },
  })

  const deleteWebhook = useMutation({
    mutationFn: (id: number) => apiFetch(`/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['webhooks'] }),
  })

  const toggleWebhook = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiFetch(`/webhooks/${id}`, { method: 'PATCH', body: { isActive } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['webhooks'] }),
  })

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Webhooks</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={open}>
          Add Webhook
        </Button>
      </Group>

      {isLoading ? (
        <Text c="dimmed">Loading…</Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>URL</Table.Th>
              <Table.Th>Events</Table.Th>
              <Table.Th>Last Status</Table.Th>
              <Table.Th>Active</Table.Th>
              <Table.Th w={60} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {webhooks.map((wh) => (
              <Table.Tr key={wh.id}>
                <Table.Td fw={500}>{wh.name}</Table.Td>
                <Table.Td>{wh.url}</Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {wh.events.map((e) => (
                      <Badge key={e} size="xs" variant="light">
                        {e}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td>{wh.lastStatus ?? '—'}</Table.Td>
                <Table.Td>
                  <Switch
                    checked={wh.isActive}
                    onChange={(e) =>
                      void toggleWebhook.mutateAsync({ id: wh.id, isActive: e.currentTarget.checked })
                    }
                  />
                </Table.Td>
                <Table.Td>
                  <Button
                    variant="subtle"
                    color="red"
                    size="compact-xs"
                    onClick={() => void deleteWebhook.mutateAsync(wh.id)}
                  >
                    <IconTrash size={14} />
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={opened} onClose={close} title="Add Webhook">
        <form onSubmit={form.onSubmit((v) => void createWebhook.mutateAsync(v))}>
          <Stack gap="md">
            <TextInput label="Name" {...form.getInputProps('name')} />
            <TextInput label="URL" {...form.getInputProps('url')} />
            <MultiSelect label="Events" data={WEBHOOK_EVENTS} {...form.getInputProps('events')} />
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" loading={createWebhook.isPending}>
                Create
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  )
}
