import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { canAccessNav, getStoredUser, isAuthenticated } from '../lib/auth'
import type { AuthUser } from '../lib/types'

interface AuthGuardProps {
  roles?: AuthUser['role'][]
}

export function AuthGuard({ roles }: AuthGuardProps) {
  const location = useLocation()

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  const user = getStoredUser()
  if (roles && !canAccessNav(user, roles)) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

export function GuestGuard() {
  if (isAuthenticated()) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
