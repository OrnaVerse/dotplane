import type { Request, Response, NextFunction } from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { deployTokens } from '../db/schema.js'
import { hashSha256 } from '../utils/crypto.js'

export function deployTokenAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing deploy token' })
    return
  }

  const token = authHeader.slice(7)
  const tokenHash = hashSha256(token)

  const record = db
    .select()
    .from(deployTokens)
    .where(and(eq(deployTokens.tokenHash, tokenHash), eq(deployTokens.isActive, true)))
    .get()

  if (!record) {
    res.status(401).json({ error: 'Invalid deploy token' })
    return
  }

  db.update(deployTokens)
    .set({ lastUsed: new Date().toISOString() })
    .where(eq(deployTokens.id, record.id))
    .run()

  req.deployTokenId = record.id
  next()
}
