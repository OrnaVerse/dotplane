import { Box, Group, Text, UnstyledButton } from '@mantine/core'
import {
  IconBrandDocker,
  IconGitBranch,
  IconLayoutDashboard,
  IconServer,
} from '@tabler/icons-react'
import { Link, useLocation } from 'react-router-dom'
import { MOBILE_NAV_ITEMS } from '../../lib/nav'

const ICONS: Record<string, typeof IconLayoutDashboard> = {
  dashboard: IconLayoutDashboard,
  instances: IconBrandDocker,
  servers: IconServer,
  releases: IconGitBranch,
}

export function BottomNav() {
  const location = useLocation()

  return (
    <Box
      component="nav"
      hiddenFrom="sm"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 200,
        borderTop: '1px solid var(--mantine-color-dark-5)',
        backgroundColor: 'var(--mantine-color-dark-7)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <Group justify="space-around" gap={0} wrap="nowrap" py="xs">
        {MOBILE_NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.id] ?? IconLayoutDashboard
          const active =
            item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path)

          return (
            <UnstyledButton
              key={item.id}
              component={Link}
              to={item.path}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '6px 4px',
                color: active ? 'var(--mantine-color-blue-4)' : 'var(--mantine-color-dimmed)',
              }}
            >
              <Icon size={22} stroke={1.5} style={{ display: 'block', margin: '0 auto 2px' }} />
              <Text size="xs" fw={active ? 600 : 400}>
                {item.label}
              </Text>
            </UnstyledButton>
          )
        })}
      </Group>
    </Box>
  )
}
