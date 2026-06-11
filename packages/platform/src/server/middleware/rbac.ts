import type { Request, Response, NextFunction } from 'express'
import type { UserRole } from '../auth/tokens.js'

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user

    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' })
      return
    }

    next()
  }
}

export function requireInstanceAccess(getInstanceId: (req: Request) => string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user

    if (!user) {
      res.status(401).json({ error: 'Unauthenticated' })
      return
    }

    if (user.role === 'superadmin') {
      next()
      return
    }

    const instanceId = getInstanceId(req)

    if (user.instanceScope === 'all') {
      next()
      return
    }

    if (!user.instanceScope.includes(instanceId)) {
      res.status(403).json({ error: 'No access to this instance' })
      return
    }

    next()
  }
}
