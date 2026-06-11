import {
  ActionIcon,
  Badge,
  Button,
  Code,
  CopyButton,
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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { IconCheck, IconCopy, IconPlus, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { apiFetch } from '../lib/api'
import type { AppRecord, DeployTokenRecord } from '../lib/types'

export function ApiAccess() {
  const queryClient = useQueryClient()
  const [opened, { open, close }] = useDisclosure(false)
  const [newToken, setNewToken] = useState<string | null>(null)

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['deploy-tokens'],
    queryFn: () => apiFetch<DeployTokenRecord[]>('/deploy-tokens'),
  })

  const { data: apps = [] } = useQuery({
    queryKey: ['apps'],
    queryFn: () => apiFetch<AppRecord[]>('/apps'),
  })

  const form = useForm({
    initialValues: { name: '', appId: '' as string | null },
    validate: { name: (v) => (v.trim() ? null : 'Required') },
  })

  const createToken = useMutation({
    mutationFn: (body: { name: string; appId?: string | null }) =>
      apiFetch<DeployTokenRecord>('/deploy-tokens', { method: 'POST', body }),
    onSuccess: (data) => {
      setNewToken(data.token ?? null)
      void queryClient.invalidateQueries({ queryKey: ['deploy-tokens'] })
      form.reset()
    },
  })

  const revokeToken = useMutation({
    mutationFn: (id: number) => apiFetch(`/deploy-tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['deploy-tokens'] }),
  })

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div>
          <Title order={2}>API Access</Title>
          <Text size="sm" c="dimmed">
            Deploy tokens for CI/CD pipelines
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={open}>
          Create Token
        </Button>
      </Group>

      {isLoading ? (
        <Text c="dimmed">Loading…</Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>App Scope</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Last Used</Table.Th>
              <Table.Th w={60} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tokens.map((token) => (
              <Table.Tr key={token.id}>
                <Table.Td fw={500}>{token.name}</Table.Td>
                <Table.Td>{token.appId ?? 'All apps'}</Table.Td>
                <Table.Td>
                  <Badge color={token.isActive ? 'green' : 'gray'} variant="light">
                    {token.isActive ? 'Active' : 'Revoked'}
                  </Badge>
                </Table.Td>
                <Table.Td>{token.lastUsed ? new Date(token.lastUsed).toLocaleString() : 'Never'}</Table.Td>
                <Table.Td>
                  <ActionIcon color="red" variant="subtle" onClick={() => void revokeToken.mutateAsync(token.id)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal
        opened={opened}
        onClose={() => {
          close()
          setNewToken(null)
        }}
        title="Create Deploy Token"
      >
        <Stack gap="md">
          {!newToken ? (
            <form onSubmit={form.onSubmit((v) => void createToken.mutateAsync(v))}>
              <Stack gap="md">
                <TextInput label="Name" placeholder="GitHub Actions" {...form.getInputProps('name')} />
                <Select
                  label="App scope"
                  placeholder="All apps"
                  clearable
                  data={apps.map((a) => ({ value: a.id, label: a.displayName }))}
                  {...form.getInputProps('appId')}
                />
                <Button type="submit" loading={createToken.isPending}>
                  Generate
                </Button>
              </Stack>
            </form>
          ) : (
            <Stack gap="sm">
              <Text size="sm" c="yellow">
                Copy this token now — it won&apos;t be shown again.
              </Text>
              <Group gap="xs" wrap="nowrap">
                <Code style={{ flex: 1, wordBreak: 'break-all' }}>{newToken}</Code>
                <CopyButton value={newToken}>
                  {({ copied, copy }) => (
                    <ActionIcon onClick={copy} variant="light">
                      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    </ActionIcon>
                  )}
                </CopyButton>
              </Group>
            </Stack>
          )}
        </Stack>
      </Modal>
    </Stack>
  )
}
