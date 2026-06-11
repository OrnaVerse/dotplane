import { Burger, Group, Text, UnstyledButton, Menu, Avatar, ActionIcon } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconLogout, IconUser } from '@tabler/icons-react'
import { Link, useNavigate } from 'react-router-dom'
import { getStoredUser, logout } from '../../lib/auth'

interface TopBarProps {
  opened: boolean
  toggle: () => void
}

export function TopBar({ opened, toggle }: TopBarProps) {
  const isMobile = useMediaQuery('(max-width: 48em)')
  const navigate = useNavigate()
  const user = getStoredUser()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <Group h="100%" px="md" justify="space-between">
      <Group gap="sm">
        {isMobile && <Burger opened={opened} onClick={toggle} size="sm" aria-label="Toggle navigation" />}
        <UnstyledButton component={Link} to="/">
          <Text fw={700} size="lg">
            Dotplane
          </Text>
        </UnstyledButton>
      </Group>

      <Menu shadow="md" width={200} position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="subtle" size="lg" aria-label="User menu">
            <Avatar radius="xl" size="sm" color="blue">
              {user?.username?.charAt(0).toUpperCase() ?? '?'}
            </Avatar>
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{user?.username ?? 'User'}</Menu.Label>
          <Menu.Item leftSection={<IconUser size={16} />} component={Link} to="/profile">
            Profile
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item leftSection={<IconLogout size={16} />} onClick={() => void handleLogout()} color="red">
            Log out
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  )
}
