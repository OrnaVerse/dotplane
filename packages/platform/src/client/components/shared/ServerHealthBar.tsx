import { Group, Paper, Progress, Stack, Text } from '@mantine/core'
import { useServerHealth } from '../../hooks/useServers'
import { formatBytesPublic } from './MemoryBar'

export function ServerHealthBar() {
  const { data, isLoading } = useServerHealth()

  if (isLoading) {
    return (
      <Paper p="md" withBorder>
        <Text size="sm" c="dimmed">
          Loading fleet health…
        </Text>
      </Paper>
    )
  }

  const totalMem = data?.totalMemoryBytes ?? 0
  const usedMem = data?.usedMemoryBytes ?? 0
  const memPercent = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0
  const cpuPercent = Math.round(data?.cpuPercent ?? 0)

  return (
    <Paper p="md" withBorder>
      <Stack gap="sm">
        <Group grow preventGrowOverflow={false} wrap="wrap" gap="lg">
          <Stack gap={4} style={{ minWidth: 160, flex: 1 }}>
            <Group justify="space-between">
              <Text size="sm" fw={500}>
                RAM
              </Text>
              <Text size="xs" c="dimmed">
                {formatBytesPublic(usedMem)} / {totalMem > 0 ? formatBytesPublic(totalMem) : '—'}
              </Text>
            </Group>
            <Progress value={memPercent} color={memPercent >= 90 ? 'red' : 'blue'} size="md" />
          </Stack>

          <Stack gap={4} style={{ minWidth: 120, flex: 1 }}>
            <Group justify="space-between">
              <Text size="sm" fw={500}>
                CPU
              </Text>
              <Text size="xs" c="dimmed">
                {cpuPercent}%
              </Text>
            </Group>
            <Progress value={cpuPercent} color={cpuPercent >= 80 ? 'yellow' : 'teal'} size="md" />
          </Stack>
        </Group>

        <Text size="sm" c="dimmed">
          {data?.healthy ?? 0} healthy · {data?.warning ?? 0} warning · {data?.down ?? 0} down
        </Text>
      </Stack>
    </Paper>
  )
}
