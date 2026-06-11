import {
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { IconPlus } from '@tabler/icons-react'
import { apiFetch } from '../lib/api'
import type { AppRecord } from '../lib/types'

export function Apps() {
  const queryClient = useQueryClient()
  const [opened, { open, close }] = useDisclosure(false)

  const { data: apps = [], isLoading } = useQuery({
    queryKey: ['apps'],
    queryFn: () => apiFetch<AppRecord[]>('/apps'),
  })

  const form = useForm({
    initialValues: {
      id: '',
      displayName: '',
      description: '',
      vcsProvider: 'github' as const,
      vcsNamespace: '',
      vcsRepo: '',
      targetFramework: 'net8.0',
    },
    validate: {
      id: (v) => (/^[a-z0-9-]+$/.test(v) ? null : 'Slug required'),
      displayName: (v) => (v.trim() ? null : 'Required'),
    },
  })

  const createApp = useMutation({
    mutationFn: (body: typeof form.values) => apiFetch('/apps', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['apps'] })
      notifications.show({ title: 'App created', message: 'Application registered', color: 'green' })
      close()
      form.reset()
    },
    onError: (err: Error) => {
      notifications.show({ title: 'Failed', message: err.message, color: 'red' })
    },
  })

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Apps</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={open}>
          Add App
        </Button>
      </Group>

      {isLoading ? (
        <Text c="dimmed">Loading…</Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Runtime</Table.Th>
              <Table.Th>Framework</Table.Th>
              <Table.Th>Source</Table.Th>
              <Table.Th>Instances</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {apps.map((app) => (
              <Table.Tr key={app.id}>
                <Table.Td>
                  <Stack gap={0}>
                    <Text fw={500}>{app.displayName}</Text>
                    <Text size="xs" c="dimmed">
                      {app.id}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light">{app.runtime}</Badge>
                </Table.Td>
                <Table.Td>{app.targetFramework}</Table.Td>
                <Table.Td>
                  {app.sourceType === 'vcs'
                    ? `${app.vcsProvider ?? 'vcs'}:${app.vcsNamespace}/${app.vcsRepo}`
                    : 'Upload'}
                </Table.Td>
                <Table.Td>{app.instanceCount ?? 0}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={opened} onClose={close} title="Add App" size="lg">
        <form onSubmit={form.onSubmit((v) => void createApp.mutate(v))}>
          <Stack gap="md">
            <TextInput label="App ID" {...form.getInputProps('id')} />
            <TextInput label="Display Name" {...form.getInputProps('displayName')} />
            <Textarea label="Description" {...form.getInputProps('description')} />
            <Select
              label="VCS Provider"
              data={[
                { value: 'github', label: 'GitHub' },
                { value: 'gitlab', label: 'GitLab' },
                { value: 'azure', label: 'Azure DevOps' },
                { value: 'bitbucket', label: 'Bitbucket' },
              ]}
              {...form.getInputProps('vcsProvider')}
            />
            <TextInput label="Namespace / Owner" {...form.getInputProps('vcsNamespace')} />
            <TextInput label="Repository" {...form.getInputProps('vcsRepo')} />
            <TextInput label="Target Framework" {...form.getInputProps('targetFramework')} />
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" loading={createApp.isPending}>
                Create
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  )
}
