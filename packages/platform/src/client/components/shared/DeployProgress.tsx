import { Alert, Group, Loader, Stack, Text, ThemeIcon } from '@mantine/core'
import { IconCheck, IconClock, IconX } from '@tabler/icons-react'
import type { DeployStep } from '../../lib/types'

interface DeployProgressProps {
  steps: DeployStep[]
  running?: boolean
  healthStatus?: string | null
  error?: string | null
}

function StepIcon({ status }: { status: DeployStep['status'] }) {
  if (status === 'running') return <Loader size={16} />
  if (status === 'done') {
    return (
      <ThemeIcon color="green" size="sm" radius="xl" variant="light">
        <IconCheck size={14} />
      </ThemeIcon>
    )
  }
  if (status === 'error') {
    return (
      <ThemeIcon color="red" size="sm" radius="xl" variant="light">
        <IconX size={14} />
      </ThemeIcon>
    )
  }
  return (
    <ThemeIcon color="gray" size="sm" radius="xl" variant="light">
      <IconClock size={14} />
    </ThemeIcon>
  )
}

export function DeployProgress({ steps, running, healthStatus, error }: DeployProgressProps) {
  if (steps.length === 0 && !running && !error) return null

  return (
    <Stack gap="xs">
      {steps.map((step, index) => (
        <Group key={`${step.step}-${index}`} gap="sm" wrap="nowrap">
          <StepIcon status={step.status} />
          <Stack gap={0} style={{ flex: 1 }}>
            <Text size="sm">{step.step}</Text>
            {step.message && (
              <Text size="xs" c="dimmed">
                {step.message}
              </Text>
            )}
          </Stack>
        </Group>
      ))}

      {running && steps.length === 0 && (
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm">Starting deployment…</Text>
        </Group>
      )}

      {healthStatus && (
        <Text size="sm" c={healthStatus === 'healthy' ? 'green' : healthStatus === 'down' ? 'red' : 'yellow'}>
          Health: {healthStatus}
        </Text>
      )}

      {error && (
        <Alert color="red" title="Deployment failed">
          {error}
        </Alert>
      )}
    </Stack>
  )
}
