import { Group, Progress, Text } from '@mantine/core'

interface MemoryBarProps {
  used?: number
  max?: number
  showLabel?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

export function MemoryBar({ used = 0, max = 0, showLabel = true, size = 'sm' }: MemoryBarProps) {
  const percent = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0
  const color = percent >= 90 ? 'red' : percent >= 75 ? 'yellow' : 'blue'

  return (
    <Group gap="xs" wrap="nowrap" align="center">
      <Progress value={percent} color={color} size={size} style={{ flex: 1 }} aria-label="Memory usage" />
      {showLabel && (
        <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          {formatBytes(used)} / {max > 0 ? formatBytes(max) : '—'}
        </Text>
      )}
    </Group>
  )
}

export function formatBytesPublic(bytes: number): string {
  return formatBytes(bytes)
}
