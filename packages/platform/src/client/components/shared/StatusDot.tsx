import { Box, Tooltip } from '@mantine/core'
import { STATUS_COLORS, type HealthStatus } from '../../theme'

interface StatusDotProps {
  status: HealthStatus | string
  size?: number
  label?: string
}

export function StatusDot({ status, size = 10, label }: StatusDotProps) {
  const color = STATUS_COLORS[status as HealthStatus] ?? STATUS_COLORS.unknown
  const dot = (
    <Box
      component="span"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: color,
        flexShrink: 0,
        boxShadow: status === 'pending' ? `0 0 6px ${color}` : undefined,
      }}
      aria-hidden
    />
  )

  if (label) {
    return (
      <Tooltip label={label}>
        <Box component="span" style={{ display: 'inline-flex', alignItems: 'center' }}>
          {dot}
        </Box>
      </Tooltip>
    )
  }

  return dot
}

export function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}
