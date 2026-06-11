import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import { IconPlayerPlay, IconPlus, IconRefresh, IconTerminal2, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DeployProgress } from '../components/shared/DeployProgress'
import { MemoryBar } from '../components/shared/MemoryBar'
import { StatusDot, statusLabel } from '../components/shared/StatusDot'
import { useCreateInstance, useDeleteInstance, useInstances, useRestartInstance } from '../hooks/useInstances'
import { useDeployment } from '../hooks/useDeployment'
import { useServers } from '../hooks/useServers'
import { apiFetch } from '../lib/api'
import type { AppRecord, ReleaseRecord } from '../lib/types'
import { ApiError } from '../lib/api'

const MEMORY_TIERS = [
  { value: 'minimal', label: 'Minimal (256MB)' },
  { value: 'standard', label: 'Standard (512MB)' },
  { value: 'professional', label: 'Professional (1GB)' },
  { value: 'enterprise', label: 'Enterprise (2GB)' },
]

export function Instances() {
  const { data: instances = [], isLoading } = useInstances()
  const { data: servers = [] } = useServers()
  const createInstance = useCreateInstance()
  const deleteInstance = useDeleteInstance()
  const restartInstance = useRestartInstance()

  const [addOpened, { open: openAdd, close: closeAdd }] = useDisclosure(false)
  const [deployTarget, setDeployTarget] = useState<{ id: string; name: string } | null>(null)
  const [deployVersion, setDeployVersion] = useState('')

  const deployment = useDeployment({
    onComplete: (success) => {
      if (success) {
        notifications.show({ title: 'Deploy complete', message: 'Instance is live', color: 'green' })
      }
    },
  })

  const { data: apps = [] } = useQuery({
    queryKey: ['apps'],
    queryFn: () => apiFetch<AppRecord[]>('/apps'),
  })

  const { data: releases = [] } = useQuery({
    queryKey: ['releases', deployTarget?.id],
    queryFn: () => apiFetch<ReleaseRecord[]>('/releases'),
    enabled: Boolean(deployTarget),
  })

  const form = useForm({
    initialValues: {
      id: '',
      displayName: '',
      appId: '',
      serverId: '',
      domain: '',
      memoryTier: 'standard',
      initialVersion: '',
    },
    validate: {
      id: (v) => (/^[a-z0-9-]+$/.test(v) ? null : 'Lowercase slug only'),
      displayName: (v) => (v.trim() ? null : 'Required'),
      appId: (v) => (v ? null : 'Required'),
      serverId: (v) => (v ? null : 'Required'),
      domain: (v) => (v.trim() ? null : 'Required'),
    },
  })

  const handleCreate = form.onSubmit(async (values) => {
    try {
      await createInstance.mutateAsync({
        ...values,
        initialVersion: values.initialVersion || undefined,
      })
      notifications.show({ title: 'Instance created', message: values.displayName, color: 'green' })
      closeAdd()
      form.reset()
    } catch (err) {
      notifications.show({
        title: 'Failed',
        message: err instanceof ApiError ? err.message : 'Could not create instance',
        color: 'red',
      })
    }
  })

  const handleDeploy = async () => {
    if (!deployTarget || !deployVersion) return
    await deployment.deployInstance(deployTarget.id, deployVersion)
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Instances</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openAdd}>
          Add Instance
        </Button>
      </Group>

      {isLoading ? (
        <Text c="dimmed">Loading…</Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>App</Table.Th>
              <Table.Th>Server</Table.Th>
              <Table.Th>Domain</Table.Th>
              <Table.Th>Version</Table.Th>
              <Table.Th>RAM</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th w={80} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {instances.map((instance) => (
              <Table.Tr key={instance.id}>
                <Table.Td>
                  <Group gap="xs">
                    <StatusDot status={instance.healthStatus} />
                    <Text fw={500}>{instance.displayName}</Text>
                  </Group>
                </Table.Td>
                <Table.Td>{instance.appName ?? instance.appId}</Table.Td>
                <Table.Td>{instance.serverName ?? instance.serverId}</Table.Td>
                <Table.Td>{instance.domain}</Table.Td>
                <Table.Td>
                  <Badge variant="light">{instance.currentVersion ?? '—'}</Badge>
                </Table.Td>
                <Table.Td style={{ minWidth: 120 }}>
                  <MemoryBar used={instance.memoryBytes} max={instance.memoryMax} size="xs" showLabel={false} />
                </Table.Td>
                <Table.Td>{statusLabel(instance.healthStatus)}</Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    <ActionIcon
                      variant="subtle"
                      aria-label="Deploy"
                      onClick={() => {
                        setDeployTarget({ id: instance.id, name: instance.displayName })
                        setDeployVersion(instance.currentVersion ?? '')
                      }}
                    >
                      <IconPlayerPlay size={16} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" component={Link} to={`/logs?instance=${instance.id}`} aria-label="Logs">
                      <IconTerminal2 size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      aria-label="Restart"
                      onClick={() =>
                        void restartInstance.mutateAsync(instance.id).then(() =>
                          notifications.show({ message: 'Restart requested', color: 'blue' }),
                        )
                      }
                    >
                      <IconRefresh size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label="Delete"
                      onClick={() =>
                        void deleteInstance.mutateAsync({ id: instance.id }).then(() =>
                          notifications.show({ message: 'Instance removed', color: 'green' }),
                        )
                      }
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={addOpened} onClose={closeAdd} title="Add Instance" size="lg">
        <form onSubmit={handleCreate}>
          <Stack gap="md">
            <TextInput
              label="Client ID"
              description="URL-safe slug"
              {...form.getInputProps('id')}
              onChange={(e) => {
                const slug = e.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')
                form.setFieldValue('id', slug)
              }}
            />
            <TextInput label="Display Name" {...form.getInputProps('displayName')} />
            <Select label="App" data={apps.map((a) => ({ value: a.id, label: a.displayName }))} {...form.getInputProps('appId')} searchable />
            <Select
              label="Server"
              data={servers.map((s) => ({ value: s.id, label: s.displayName }))}
              {...form.getInputProps('serverId')}
              searchable
            />
            <TextInput label="Domain" {...form.getInputProps('domain')} />
            <Select label="Memory Tier" data={MEMORY_TIERS} {...form.getInputProps('memoryTier')} />
            <Select
              label="Initial Version"
              placeholder="Optional"
              clearable
              data={releases.map((r) => ({ value: r.version, label: r.version }))}
              {...form.getInputProps('initialVersion')}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeAdd}>
                Cancel
              </Button>
              <Button type="submit" loading={createInstance.isPending}>
                Create
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={Boolean(deployTarget)}
        onClose={() => {
          setDeployTarget(null)
          deployment.reset()
        }}
        title={deployTarget ? `Deploy — ${deployTarget.name}` : 'Deploy'}
      >
        <Stack gap="md">
          <Select
            label="Version"
            data={releases.map((r) => ({ value: r.version, label: r.version }))}
            value={deployVersion}
            onChange={(v) => setDeployVersion(v ?? '')}
            searchable
          />
          <DeployProgress
            steps={deployment.steps}
            running={deployment.running}
            healthStatus={deployment.healthStatus}
            error={deployment.error}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeployTarget(null)}>
              Close
            </Button>
            <Button loading={deployment.running} onClick={() => void handleDeploy()} disabled={!deployVersion}>
              Deploy Now
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
