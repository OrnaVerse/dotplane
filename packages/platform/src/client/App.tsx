import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthGuard, GuestGuard } from './components/AuthGuard'
import { Shell } from './components/layout/Shell'
import { getBasePath } from './lib/api'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Instances } from './pages/Instances'
import { Servers } from './pages/Servers'
import { Releases } from './pages/Releases'
import { SDK } from './pages/SDK'
import { Apps } from './pages/Apps'
import { Users } from './pages/Users'
import { AuditLog } from './pages/AuditLog'
import { Settings } from './pages/Settings'
import { Profile } from './pages/Profile'
import { Logs } from './pages/Logs'
import { Webhooks } from './pages/Webhooks'
import { ApiAccess } from './pages/ApiAccess'
import { Postgres } from './pages/Postgres'

export function App() {
  return (
    <Routes>
      <Route element={<GuestGuard />}>
        <Route path="/login" element={<Login />} />
      </Route>

      <Route element={<AuthGuard />}>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="instances" element={<Instances />} />
          <Route path="servers" element={<Servers />} />
          <Route path="releases" element={<Releases />} />
          <Route path="sdk" element={<SDK />} />
          <Route path="apps" element={<Apps />} />
          <Route path="logs" element={<Logs />} />
          <Route path="postgres" element={<Postgres />} />
          <Route path="profile" element={<Profile />} />

          <Route element={<AuthGuard roles={['superadmin']} />}>
            <Route path="webhooks" element={<Webhooks />} />
            <Route path="api-access" element={<ApiAccess />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="users" element={<Users />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function appBasename(): string {
  return getBasePath()
}
