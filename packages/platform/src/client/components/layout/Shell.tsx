import { AppShell } from '@mantine/core'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'
import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function Shell() {
  const [opened, { toggle, close }] = useDisclosure(false)
  const isMobile = useMediaQuery('(max-width: 48em)')

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: 240,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="md"
      styles={{
        main: {
          paddingBottom: isMobile ? 'calc(72px + env(safe-area-inset-bottom))' : undefined,
        },
      }}
    >
      <AppShell.Header>
        <TopBar opened={opened} toggle={toggle} />
      </AppShell.Header>

      <AppShell.Navbar p={0}>
        <Sidebar onNavigate={close} />
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>

      <BottomNav />
    </AppShell>
  )
}
