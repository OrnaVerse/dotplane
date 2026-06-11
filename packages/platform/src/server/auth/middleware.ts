import type { Request, Response, NextFunction } from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { sessions } from '../db/schema.js'
import { verifyAccessToken } from './tokens.js'

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthenticated' })
    return
  }

  const token = authHeader.slice(7)

  try {
    const payload = verifyAccessToken(token)

    const session = db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.sessionId, payload.sessionId),
          eq(sessions.revoked, false),
        ),
      )
      .get()

    if (!session) {
      res.status(401).json({ error: 'Session revoked' })
      return
    }

    if (new Date(session.expiresAt) <= new Date()) {
      res.status(401).json({ error: 'Session expired' })
      return
    }

    req.user = payload
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}
