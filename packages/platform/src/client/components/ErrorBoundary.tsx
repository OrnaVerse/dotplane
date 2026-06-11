import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Container, Stack, Text, Title } from '@mantine/core'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <Container size="sm" py="xl">
          <Stack gap="md">
            <Title order={2}>Something went wrong</Title>
            <Text c="dimmed">An unexpected error occurred. Reload the page to try again.</Text>
            <Button onClick={() => window.location.reload()}>Reload</Button>
          </Stack>
        </Container>
      )
    }

    return this.props.children
  }
}
