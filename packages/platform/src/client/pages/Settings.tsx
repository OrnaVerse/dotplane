import { useEffect } from 'react'
import { Button, Group, Stack, Switch, Text, TextInput, Title, Paper } from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import type { SettingRecord } from '../lib/types'

export function Settings() {
  const queryClient = useQueryClient()

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<SettingRecord[]>('/settings'),
  })

  const form = useForm({
    initialValues: {
      platformName: 'Dotplane',
      pushNotifications: true,
      deployWebhookUrl: '',
    },
  })

  useEffect(() => {
    if (settings.length === 0) return
    const map = Object.fromEntries(settings.map((s) => [s.key, s.value]))
    form.setValues({
      platformName: map.platform_name ?? 'Dotplane',
      pushNotifications: map.push_notifications === 'true',
      deployWebhookUrl: map.deploy_webhook_url ?? '',
    })
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, string | boolean>) =>
      apiFetch('/settings', { method: 'PUT', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      notifications.show({ title: 'Settings saved', message: 'Platform settings updated', color: 'green' })
    },
    onError: (err: Error) => {
      notifications.show({ title: 'Save failed', message: err.message, color: 'red' })
    },
  })

  return (
    <Stack gap="md">
      <Title order={2}>Settings</Title>

      <Paper p="md" withBorder maw={560}>
        <form
          onSubmit={form.onSubmit((values) =>
            void saveMutation.mutateAsync({
              platform_name: values.platformName,
              push_notifications: values.pushNotifications,
              deploy_webhook_url: values.deployWebhookUrl,
            }),
          )}
        >
          <Stack gap="md">
            <TextInput label="Platform Name" {...form.getInputProps('platformName')} />
            <Switch
              label="Push notifications for deploy events"
              {...form.getInputProps('pushNotifications', { type: 'checkbox' })}
            />
            <TextInput label="Default deploy webhook URL" {...form.getInputProps('deployWebhookUrl')} />
            <Group justify="flex-end">
              <Button type="submit" loading={saveMutation.isPending}>
                Save
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      {isLoading && <Text c="dimmed">Loading settings…</Text>}
    </Stack>
  )
}
