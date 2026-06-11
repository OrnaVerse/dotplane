import { NavLink, ScrollArea, Stack, Text } from '@mantine/core'
import {
  IconApps,
  IconBrandDocker,
  IconDatabase,
  IconFileText,
  IconGitBranch,
  IconKey,
  IconLayoutDashboard,
  IconPackage,
  IconClipboardList,
  IconServer,
  IconSettings,
  IconUsers,
  IconWebhook,
} from '@tabler/icons-react'
import { Link, useLocation } from 'react-router-dom'
import { canAccessNav, getStoredUser } from '../../lib/auth'
import { NAV_ITEMS } from '../../lib/nav'

const ICONS: Record<string, typeof IconLayoutDashboard> = {
  dashboard: IconLayoutDashboard,
  instances: IconBrandDocker,
  servers: IconServer,
  releases: IconGitBranch,
  apps: IconApps,
  sdk: IconPackage,
  logs: IconFileText,
  postgres: IconDatabase,
  webhooks: IconWebhook,
  'api-access': IconKey,
  audit: IconClipboardList,
  users: IconUsers,
  settings: IconSettings,
}

interface SidebarProps {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const location = useLocation()
  const user = getStoredUser()
  const visibleItems = NAV_ITEMS.filter((item) => canAccessNav(user, item.roles))

  return (
    <ScrollArea h="100%">
      <Stack gap={4} p="sm">
        <Text size="xs" tt="uppercase" c="dimmed" fw={600} px="sm" mb={4}>
          Navigation
        </Text>
        {visibleItems.map((item) => {
          const Icon = ICONS[item.id] ?? IconLayoutDashboard
          const active =
            item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path)

          return (
            <NavLink
              key={item.id}
              component={Link}
              to={item.path}
              label={item.label}
              leftSection={<Icon size={18} stroke={1.5} />}
              active={active}
              onClick={onNavigate}
              variant="light"
            />
          )
        })}
      </Stack>
    </ScrollArea>
  )
}
