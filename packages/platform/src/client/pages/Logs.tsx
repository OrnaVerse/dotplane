import { Button, Group, ScrollArea, Select, Stack, Text, Title, Paper, Switch } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSSE } from '../hooks/useSSE'
import { useInstances } from '../hooks/useInstances'

interface LogLine {
  timestamp?: string
  level?: string
  message?: string
  line?: string
}

export function Logs() {
  const [searchParams, setSearchParams] = useSearchParams()
  const instanceFromUrl = searchParams.get('instance') ?? ''
  const [instanceId, setInstanceId] = useState(instanceFromUrl)
  const [lines, setLines] = useState('100')
  const [paused, setPaused] = useState(false)
  const [logBuffer, setLogBuffer] = useState<LogLine[]>([])
  const [debouncedInstance] = useDebouncedValue(instanceId, 300)

  const { data: instances = [] } = useInstances()

  const instanceOptions = useMemo(
    () => instances.map((i) => ({ value: i.id, label: i.displayName })),
    [instances],
  )

  useSSE(debouncedInstance ? `/instances/${debouncedInstance}/logs?lines=${lines}` : '', {
    enabled: Boolean(debouncedInstance) && !paused,
    onEvent: (raw) => {
      const event = raw as { line?: string | LogLine }
      if (paused) return

      if (typeof event.line === 'string') {
        try {
          const parsed = JSON.parse(event.line) as LogLine
          setLogBuffer((prev) => [...prev.slice(-499), parsed])
        } catch {
          setLogBuffer((prev) => [...prev.slice(-499), { message: event.line as string }])
        }
      } else if (event.line && typeof event.line === 'object') {
        setLogBuffer((prev) => [...prev.slice(-499), event.line as LogLine])
      }
    },
  })

  const handleInstanceChange = (value: string | null) => {
    const id = value ?? ''
    setInstanceId(id)
    setLogBuffer([])
    if (id) {
      setSearchParams({ instance: id })
    } else {
      setSearchParams({})
    }
  }

  return (
    <Stack gap="md">
      <Title order={2}>Logs</Title>

      <Group wrap="wrap">
        <Select
          label="Instance"
          placeholder="Select instance"
          data={instanceOptions}
          value={instanceId || null}
          onChange={handleInstanceChange}
          searchable
          w={280}
        />
        <Select
          label="Lines"
          data={['100', '500', '1000']}
          value={lines}
          onChange={(v) => {
            setLines(v ?? '100')
            setLogBuffer([])
          }}
          w={120}
        />
        <Switch label="Pause scroll" checked={paused} onChange={(e) => setPaused(e.currentTarget.checked)} mt="auto" />
        <Button
          variant="light"
          leftSection={paused ? <IconPlayerPlay size={14} /> : <IconPlayerPause size={14} />}
          onClick={() => setPaused((p) => !p)}
          mt="auto"
        >
          {paused ? 'Resume' : 'Pause'}
        </Button>
        <Button variant="default" onClick={() => setLogBuffer([])} mt="auto">
          Clear
        </Button>
      </Group>

      <Paper p="md" withBorder>
        {!instanceId ? (
          <Text c="dimmed">Select an instance to stream logs.</Text>
        ) : (
          <ScrollArea h={480} type="auto" offsetScrollbars>
            <Stack gap={2}>
              {logBuffer.map((entry, index) => (
                <Text key={index} size="xs" ff="monospace" c="dimmed">
                  {entry.timestamp && `${entry.timestamp}  `}
                  {entry.level && (
                    <Text span c={entry.level === 'warn' ? 'yellow' : entry.level === 'error' ? 'red' : undefined}>
                      {entry.level}{' '}
                    </Text>
                  )}
                  {entry.message ?? entry.line ?? JSON.stringify(entry)}
                </Text>
              ))}
              {logBuffer.length === 0 && (
                <Text size="sm" c="dimmed">
                  Waiting for log stream…
                </Text>
              )}
            </Stack>
          </ScrollArea>
        )}
      </Paper>
    </Stack>
  )
}
