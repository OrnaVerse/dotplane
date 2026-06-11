import { useState } from 'react'
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
  Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDisclosure } from '@mantine/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconCheck, IconCopy, IconPlus } from '@tabler/icons-react'
import { apiFetch } from '../lib/api'
import type { UserRecord } from '../lib/types'

export function Users() {
  const queryClient = useQueryClient()
  const [opened, { open, close }] = useDisclosure(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<UserRecord[]>('/users'),
  })

  const form = useForm({
    initialValues: { role: 'manager' as UserRecord['role'] },
  })

  const inviteMutation = useMutation({
    mutationFn: (body: { role: string }) =>
      apiFetch<{ inviteUrl: string }>('/users/invite', { method: 'POST', body }),
    onSuccess: (data: { inviteUrl: string }) => {
      setInviteUrl(data.inviteUrl)
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Users</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={open}>
          Invite User
        </Button>
      </Group>

      {isLoading ? (
        <Text c="dimmed">Loading…</Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Username</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Last Login</Table.Th>
              <Table.Th>Scope</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map((user) => (
              <Table.Tr key={user.id}>
                <Table.Td fw={500}>{user.username}</Table.Td>
                <Table.Td>
                  <Badge variant="light">{user.role}</Badge>
                </Table.Td>
                <Table.Td>
                  <Badge color={user.isActive ? 'green' : 'gray'}>{user.isActive ? 'Active' : 'Inactive'}</Badge>
                </Table.Td>
                <Table.Td>{user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}</Table.Td>
                <Table.Td>{user.instanceCount != null ? `${user.instanceCount} clients` : 'All'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={opened} onClose={close} title="Invite User">
        <Stack gap="md">
          <Select
            label="Role"
            data={[
              { value: 'manager', label: 'Manager' },
              { value: 'viewer', label: 'Viewer' },
            ]}
            {...form.getInputProps('role')}
          />
          <Button loading={inviteMutation.isPending} onClick={() => void inviteMutation.mutateAsync(form.values)}>
            Generate Invite Link
          </Button>
          {inviteUrl && (
            <Group gap="xs" wrap="nowrap">
              <Code style={{ flex: 1, wordBreak: 'break-all' }}>{inviteUrl}</Code>
              <CopyButton value={inviteUrl}>
                {({ copied, copy }) => (
                  <ActionIcon onClick={copy} variant="light" aria-label="Copy invite link">
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                )}
              </CopyButton>
            </Group>
          )}
        </Stack>
      </Modal>
    </Stack>
  )
}
