import {
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Image,
  Modal,
  PasswordInput,
  PinInput,
  Stack,
  Text,
  Title,
  Paper,
  ActionIcon,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useMutation } from '@tanstack/react-query'
import { IconCheck, IconCopy, IconShield } from '@tabler/icons-react'
import { useState } from 'react'
import { getStoredUser } from '../lib/auth'
import { apiFetch } from '../lib/api'

interface MfaSetupResponse {
  secret: string
  qrCodeDataUrl: string
  backupCodes: string[]
  mfaToken: string
}

export function Profile() {
  const user = getStoredUser()
  const [setupOpened, { open: openSetup, close: closeSetup }] = useDisclosure(false)
  const [setupData, setSetupData] = useState<MfaSetupResponse | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [disablePassword, setDisablePassword] = useState('')

  const setup2fa = useMutation({
    mutationFn: () => apiFetch<MfaSetupResponse>('/auth/2fa/setup', { method: 'POST' }),
    onSuccess: (data: MfaSetupResponse) => {
      setSetupData(data)
      openSetup()
    },
  })

  const verifySetup = useMutation({
    mutationFn: () =>
      apiFetch('/auth/2fa/verify-setup', {
        method: 'POST',
        body: { mfaToken: setupData?.mfaToken, totpCode },
      }),
    onSuccess: () => {
      notifications.show({ title: '2FA enabled', message: 'Authenticator linked', color: 'green' })
      closeSetup()
      setSetupData(null)
    },
  })

  const disable2fa = useMutation({
    mutationFn: () => apiFetch('/auth/2fa/disable', { method: 'POST', body: { password: disablePassword } }),
    onSuccess: () => {
      notifications.show({ title: '2FA disabled', message: 'Two-factor authentication removed', color: 'green' })
      setDisablePassword('')
    },
  })

  return (
    <Stack gap="md">
      <Title order={2}>Profile</Title>

      <Paper p="md" withBorder maw={480}>
        <Stack gap="md">
          <Group>
            <Text fw={500}>Username</Text>
            <Text>{user?.username ?? '—'}</Text>
          </Group>
          <Group>
            <Text fw={500}>Role</Text>
            <Badge variant="light">{user?.role ?? '—'}</Badge>
          </Group>
        </Stack>
      </Paper>

      <Paper p="md" withBorder maw={480}>
        <Stack gap="md">
          <Group>
            <IconShield size={20} />
            <Text fw={600}>Two-Factor Authentication</Text>
          </Group>
          <Button loading={setup2fa.isPending} onClick={() => void setup2fa.mutate()}>
            Enable 2FA
          </Button>
          <PasswordInput
            label="Password to disable 2FA"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.currentTarget.value)}
          />
          <Button
            variant="light"
            color="red"
            loading={disable2fa.isPending}
            onClick={() => void disable2fa.mutate()}
            disabled={!disablePassword}
          >
            Disable 2FA
          </Button>
        </Stack>
      </Paper>

      <Modal opened={setupOpened} onClose={closeSetup} title="Set up 2FA" size="md">
        {setupData && (
          <Stack gap="md">
            <Image src={setupData.qrCodeDataUrl} alt="2FA QR code" maw={200} mx="auto" />
            <Group gap="xs">
              <Code style={{ flex: 1 }}>{setupData.secret}</Code>
              <CopyButton value={setupData.secret}>
                {({ copied, copy }) => (
                  <ActionIcon onClick={copy} variant="light">
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                )}
              </CopyButton>
            </Group>
            <Text size="sm">Backup codes (save these):</Text>
            <Code block>{setupData.backupCodes.join('\n')}</Code>
            <PinInput length={6} type="number" value={totpCode} onChange={setTotpCode} />
            <Button loading={verifySetup.isPending} onClick={() => void verifySetup.mutate()} disabled={totpCode.length !== 6}>
              Verify & Enable
            </Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}
