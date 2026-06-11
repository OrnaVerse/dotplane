import {
  Anchor,
  Button,
  Center,
  Paper,
  PasswordInput,
  PinInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { login, verify2fa } from '../lib/auth'
import { ApiError } from '../lib/api'

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [step, setStep] = useState<'credentials' | '2fa'>('credentials')
  const [mfaToken, setMfaToken] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [loading, setLoading] = useState(false)

  const form = useForm({
    initialValues: { username: '', password: '' },
    validate: {
      username: (v) => (v.trim().length > 0 ? null : 'Username required'),
      password: (v) => (v.length > 0 ? null : 'Password required'),
    },
  })

  const handleLogin = form.onSubmit(async (values) => {
    setLoading(true)
    try {
      const result = await login(values.username, values.password)

      if (result.mfaRequired && result.mfaToken) {
        setMfaToken(result.mfaToken)
        setStep('2fa')
        return
      }

      notifications.show({ title: 'Welcome', message: `Signed in as ${result.user?.username}`, color: 'green' })
      navigate(from, { replace: true })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Login failed'
      notifications.show({ title: 'Login failed', message, color: 'red' })
    } finally {
      setLoading(false)
    }
  })

  const handle2fa = async (code: string) => {
    if (code.length < (useBackup ? 4 : 6)) return

    setLoading(true)
    try {
      const result = await verify2fa(mfaToken, code, useBackup)
      notifications.show({ title: 'Welcome', message: `Signed in as ${result.user?.username}`, color: 'green' })
      navigate(from, { replace: true })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Verification failed'
      notifications.show({ title: '2FA failed', message, color: 'red' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Center mih="100dvh" p="md">
      <Paper p="xl" radius="md" withBorder w="100%" maw={400}>
        <Stack gap="lg">
          <Stack gap={4}>
            <Title order={2}>Dotplane</Title>
            <Text c="dimmed" size="sm">
              {step === 'credentials' ? 'Sign in to your platform' : 'Two-factor authentication'}
            </Text>
          </Stack>

          {step === 'credentials' ? (
            <form onSubmit={handleLogin}>
              <Stack gap="md">
                <TextInput label="Username" autoComplete="username" {...form.getInputProps('username')} />
                <PasswordInput label="Password" autoComplete="current-password" {...form.getInputProps('password')} />
                <Button type="submit" fullWidth loading={loading}>
                  Sign in
                </Button>
              </Stack>
            </form>
          ) : (
            <Stack gap="md">
              {useBackup ? (
                <TextInput
                  label="Backup code"
                  placeholder="XXXX-XXXX"
                  onChange={(e) => void handle2fa(e.currentTarget.value)}
                />
              ) : (
                <>
                  <Text size="sm">Enter the 6-digit code from your authenticator app.</Text>
                  <PinInput length={6} type="number" oneTimeCode onComplete={(v) => void handle2fa(v)} disabled={loading} />
                </>
              )}

              <Anchor
                component="button"
                type="button"
                size="sm"
                onClick={() => setUseBackup((v) => !v)}
              >
                {useBackup ? 'Use authenticator app' : 'Use backup code instead'}
              </Anchor>

              <Button variant="subtle" onClick={() => setStep('credentials')}>
                Back
              </Button>
            </Stack>
          )}
        </Stack>
      </Paper>
    </Center>
  )
}
