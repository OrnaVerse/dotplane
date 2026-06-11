import {
  Badge,
  Button,
  Group,
  Progress,
  Select,
  Stack,
  Text,
  Title,
  Paper,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { IconDownload, IconRefresh, IconRocket } from '@tabler/icons-react'
import { useState } from 'react'
import { useDeployment } from '../hooks/useDeployment'
import { apiFetch } from '../lib/api'
import type { AppRecord, DownloadProgress, ReleaseRecord } from '../lib/types'
export function Releases() {
  const queryClient = useQueryClient()
  const [appId, setAppId] = useState<string | null>(null)
  const [downloadingVersion, setDownloadingVersion] = useState<string | null>(null)

  const { data: apps = [] } = useQuery({
    queryKey: ['apps'],
    queryFn: () => apiFetch<AppRecord[]>('/apps'),
  })

  const selectedAppId = appId ?? apps[0]?.id ?? null

  const { data: releases = [], isLoading } = useQuery({
    queryKey: ['releases', selectedAppId],
    queryFn: () => apiFetch<ReleaseRecord[]>(`/releases?appId=${selectedAppId}`),
    enabled: Boolean(selectedAppId),
  })

  const { data: downloadProgress } = useQuery({
    queryKey: ['releases', 'download-progress', downloadingVersion],
    queryFn: () => apiFetch<DownloadProgress>(`/releases/download-progress/${downloadingVersion}`),
    enabled: Boolean(downloadingVersion),
    refetchInterval: downloadingVersion ? 1000 : false,
  })

  const syncMutation = useMutation({
    mutationFn: () =>
      apiFetch('/releases/sync', { method: 'POST', body: { appId: selectedAppId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['releases'] })
      notifications.show({ title: 'Synced', message: 'Releases updated from VCS', color: 'green' })
    },
    onError: (err: Error) => {
      notifications.show({ title: 'Sync failed', message: err.message, color: 'red' })
    },
  })

  const downloadMutation = useMutation({
    mutationFn: (version: string) =>
      apiFetch(`/releases/${version}/download`, { method: 'POST', body: { appId: selectedAppId } }),
    onSuccess: (_, version) => {
      setDownloadingVersion(version)
    },
    onError: (err: Error) => {
      notifications.show({ title: 'Download failed', message: err.message, color: 'red' })
    },
  })

  const deployment = useDeployment({
    onComplete: (success) => {
      notifications.show({
        title: success ? 'Deploy all complete' : 'Deploy all failed',
        message: success ? 'All instances updated' : 'Some instances failed',
        color: success ? 'green' : 'red',
      })
    },
  })

  if (downloadProgress?.status === 'done') {
    setTimeout(() => setDownloadingVersion(null), 1500)
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>Releases</Title>
        <Group>
          <Select
            label="App"
            data={apps.map((a) => ({ value: a.id, label: a.displayName }))}
            value={selectedAppId}
            onChange={setAppId}
            w={200}
          />
          <Button
            leftSection={<IconRefresh size={16} />}
            variant="light"
            loading={syncMutation.isPending}
            onClick={() => void syncMutation.mutate()}
            disabled={!selectedAppId}
            mt="auto"
          >
            Sync from VCS
          </Button>
        </Group>
      </Group>

      {isLoading ? (
        <Text c="dimmed">Loading releases…</Text>
      ) : (
        <Stack gap="sm">
          {releases.map((release) => (
            <Paper key={release.id} p="md" withBorder>
              <Group justify="space-between" align="flex-start" wrap="wrap">
                <Stack gap={4}>
                  <Group gap="sm">
                    <Text fw={600}>{release.version}</Text>
                    <Badge color={release.cachedPath || release.isCached ? 'green' : 'gray'} variant="light">
                      {release.cachedPath || release.isCached ? 'Cached' : 'Not cached'}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    Released {new Date(release.publishedAt).toLocaleString()}
                  </Text>
                  {release.releaseNotes && (
                    <Text size="sm" lineClamp={2}>
                      {release.releaseNotes}
                    </Text>
                  )}
                  {release.artifactSize != null && (
                    <Text size="xs" c="dimmed">
                      app.zip · {(release.artifactSize / 1_048_576).toFixed(1)} MB
                    </Text>
                  )}
                </Stack>
                <Group>
                  <Button
                    size="sm"
                    variant="default"
                    leftSection={<IconDownload size={14} />}
                    loading={downloadMutation.isPending}
                    onClick={() => void downloadMutation.mutate(release.version)}
                  >
                    Download
                  </Button>
                  <Button
                    size="sm"
                    leftSection={<IconRocket size={14} />}
                    loading={deployment.running}
                    onClick={() =>
                      selectedAppId &&
                      void deployment.deployAll({ appId: selectedAppId, version: release.version })
                    }
                  >
                    Deploy All
                  </Button>
                </Group>
              </Group>

              {downloadingVersion === release.version && downloadProgress && (
                <Stack gap={4} mt="md">
                  <Text size="sm">Downloading {release.version}…</Text>
                  <Progress value={downloadProgress.percent} size="md" />
                  <Text size="xs" c="dimmed">
                    {(downloadProgress.bytesDownloaded / 1_048_576).toFixed(1)} MB /{' '}
                    {(downloadProgress.totalBytes / 1_048_576).toFixed(1)} MB
                  </Text>
                </Stack>
              )}
            </Paper>
          ))}
        </Stack>
      )}

      {releases.length === 0 && !isLoading && (
        <Text c="dimmed">No releases found. Sync from your VCS provider.</Text>
      )}
    </Stack>
  )
}
