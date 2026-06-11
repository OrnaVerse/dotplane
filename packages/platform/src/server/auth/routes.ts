import { Router } from 'express'
import type { Request, Response } from 'express'
import argon2 from 'argon2'
import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'
import { v4 as uuid } from 'uuid'
import { requireEnv } from '../config.js'
import { db } from '../db/index.js'
import {
  sessions,
  userBackupCodes,
  userInstanceAccess,
  users,
} from '../db/schema.js'
import { encrypt, decrypt } from '../utils/crypto.js'
import { authMiddleware } from './middleware.js'
import { loginRateLimiter, refreshRateLimiter } from '../middleware/rateLimit.js'
import {
  hashRefreshToken,
  signAccessToken,
  signMfaToken,
  signRefreshToken,
  verifyMfaToken,
  type JWTPayload,
  type UserRole,
} from './tokens.js'

const router: Router = Router()

const BACKUP_CODE_COUNT = 8
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const LoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
})

const MfaChallengeSchema = z
  .object({
    mfaToken: z.string().min(1),
    totpCode: z.string().length(6).optional(),
    backupCode: z.string().min(1).optional(),
  })
  .refine((data) => data.totpCode !== undefined || data.backupCode !== undefined, {
    message: 'totpCode or backupCode is required',
  })

const MfaVerifySetupSchema = z.object({
  mfaToken: z.string().min(1),
  totpCode: z.string().length(6),
})

const MfaDisableSchema = z.object({
  password: z.string().min(1).max(128),
})

type SessionUser = {
  id: number
  username: string
  role: UserRole
}

function refreshCookiePath(): string {
  return `/${requireEnv('PLATFORM_URL_KEY')}/api/auth/refresh`
}

function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: SESSION_TTL_MS,
    path: refreshCookiePath(),
  })
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie('refresh_token', {
    path: refreshCookiePath(),
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
  })
}

async function resolveInstanceScope(
  userId: number,
  role: UserRole,
): Promise<string[] | 'all'> {
  if (role === 'manager') {
    const scoped = db
      .select({ instanceId: userInstanceAccess.instanceId })
      .from(userInstanceAccess)
      .where(eq(userInstanceAccess.userId, userId))
      .all()

    if (scoped.length > 0) {
      return scoped.map((row) => row.instanceId)
    }
  }

  return 'all'
}

function buildAccessPayload(
  user: SessionUser,
  sessionId: string,
  instanceScope: string[] | 'all',
): JWTPayload {
  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    sessionId,
    instanceScope,
  }
}

async function createSession(
  user: SessionUser,
  req: Request,
  res: Response,
): Promise<{ accessToken: string }> {
  const sessionId = uuid()
  const refreshToken = signRefreshToken()
  const refreshHash = hashRefreshToken(refreshToken)
  const instanceScope = await resolveInstanceScope(user.id, user.role)

  db.insert(sessions)
    .values({
      sessionId,
      userId: user.id,
      refreshToken: refreshHash,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    })
    .run()

  db.update(users)
    .set({ lastLogin: new Date().toISOString() })
    .where(eq(users.id, user.id))
    .run()

  const accessToken = signAccessToken(buildAccessPayload(user, sessionId, instanceScope))
  setRefreshCookie(res, refreshToken)

  return { accessToken }
}

function generateBackupCodes(): string[] {
  const codes: string[] = []

  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const partA = Math.random().toString(36).slice(2, 6).toUpperCase()
    const partB = Math.random().toString(36).slice(2, 6).toUpperCase()
    codes.push(`${partA}-${partB}`)
  }

  return codes
}

async function storeBackupCodes(userId: number, codes: string[]): Promise<void> {
  db.delete(userBackupCodes).where(eq(userBackupCodes.userId, userId)).run()

  for (const code of codes) {
    const codeHash = await argon2.hash(code)
    db.insert(userBackupCodes)
      .values({ userId, codeHash })
      .run()
  }
}

function buildTotp(username: string, secretBase32: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: 'Dotplane',
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  })
}

function verifyTotpCode(totp: OTPAuth.TOTP, code: string): boolean {
  return totp.validate({ token: code, window: 1 }) !== null
}

async function verifyBackupCode(userId: number, code: string): Promise<boolean> {
  const records = db
    .select()
    .from(userBackupCodes)
    .where(and(eq(userBackupCodes.userId, userId), isNull(userBackupCodes.usedAt)))
    .all()

  for (const record of records) {
    const valid = await argon2.verify(record.codeHash, code)
    if (!valid) continue

    db.update(userBackupCodes)
      .set({ usedAt: new Date().toISOString() })
      .where(eq(userBackupCodes.id, record.id))
      .run()

    return true
  }

  return false
}

router.post('/login', loginRateLimiter, async (req, res) => {
  const body = LoginSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }

  const { username, password } = body.data
  const user = db.select().from(users).where(eq(users.username, username)).get()

  const dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$dummy'
  const hash = user?.passwordHash ?? dummyHash
  const valid = await argon2.verify(hash, password)

  if (!valid || !user || !user.isActive) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  if (user.totpEnabled) {
    const mfaToken = signMfaToken({
      userId: user.id,
      username: user.username,
      purpose: 'mfa_challenge',
    })

    res.json({ mfaRequired: true, mfaToken })
    return
  }

  const { accessToken } = await createSession(
    { id: user.id, username: user.username, role: user.role },
    req,
    res,
  )

  res.json({
    accessToken,
    user: { username: user.username, role: user.role },
  })
})

router.post('/refresh', refreshRateLimiter, async (req, res) => {
  const refreshToken = req.cookies?.refresh_token as string | undefined

  if (!refreshToken) {
    res.status(401).json({ error: 'No refresh token' })
    return
  }

  const hash = hashRefreshToken(refreshToken)

  const session = db
    .select({
      sessionId: sessions.sessionId,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      username: users.username,
      role: users.role,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.refreshToken, hash),
        eq(sessions.revoked, false),
      ),
    )
    .get()

  if (!session || !session.isActive || new Date(session.expiresAt) <= new Date()) {
    clearRefreshCookie(res)
    res.status(401).json({ error: 'Invalid session' })
    return
  }

  const newRefreshToken = signRefreshToken()
  const newRefreshHash = hashRefreshToken(newRefreshToken)

  db.update(sessions)
    .set({
      refreshToken: newRefreshHash,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    })
    .where(eq(sessions.sessionId, session.sessionId))
    .run()

  const instanceScope = await resolveInstanceScope(session.userId, session.role)

  const accessToken = signAccessToken(
    buildAccessPayload(
      { id: session.userId, username: session.username, role: session.role },
      session.sessionId,
      instanceScope,
    ),
  )

  setRefreshCookie(res, newRefreshToken)
  res.json({ accessToken })
})

router.post('/logout', refreshRateLimiter, async (req, res) => {
  const refreshToken = req.cookies?.refresh_token as string | undefined

  if (refreshToken) {
    const hash = hashRefreshToken(refreshToken)
    db.update(sessions)
      .set({ revoked: true })
      .where(eq(sessions.refreshToken, hash))
      .run()
  }

  clearRefreshCookie(res)
  res.json({ ok: true })
})

router.post('/2fa/challenge', loginRateLimiter, async (req, res) => {
  const body = MfaChallengeSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }

  let mfaPayload
  try {
    mfaPayload = verifyMfaToken(body.data.mfaToken)
  } catch {
    res.status(401).json({ error: 'Invalid MFA token' })
    return
  }

  if (mfaPayload.purpose !== 'mfa_challenge') {
    res.status(401).json({ error: 'Invalid MFA token' })
    return
  }

  const user = db.select().from(users).where(eq(users.id, mfaPayload.userId)).get()

  if (!user || !user.isActive || !user.totpEnabled || !user.totpSecretEnc) {
    res.status(401).json({ error: 'Invalid MFA challenge' })
    return
  }

  const secretBase32 = decrypt(user.totpSecretEnc)
  const totp = buildTotp(user.username, secretBase32)

  let verified = false

  if (body.data.totpCode) {
    verified = verifyTotpCode(totp, body.data.totpCode)
  } else if (body.data.backupCode) {
    verified = await verifyBackupCode(user.id, body.data.backupCode)
  }

  if (!verified) {
    res.status(401).json({ error: 'Invalid verification code' })
    return
  }

  const { accessToken } = await createSession(
    { id: user.id, username: user.username, role: user.role },
    req,
    res,
  )

  res.json({
    accessToken,
    user: { username: user.username, role: user.role },
  })
})

router.post('/2fa/setup', authMiddleware, async (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'Unauthenticated' })
    return
  }

  const record = db.select().from(users).where(eq(users.id, user.userId)).get()
  if (!record) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  if (record.totpEnabled) {
    res.status(400).json({ error: '2FA is already enabled' })
    return
  }

  const secret = new OTPAuth.Secret({ size: 20 })
  const totp = buildTotp(record.username, secret.base32)
  const qrCodeDataUrl = await QRCode.toDataURL(totp.toString())
  const backupCodes = generateBackupCodes()

  db.update(users)
    .set({ totpSecretEnc: encrypt(secret.base32), totpEnabled: false })
    .where(eq(users.id, record.id))
    .run()

  await storeBackupCodes(record.id, backupCodes)

  const mfaToken = signMfaToken({
    userId: record.id,
    username: record.username,
    purpose: 'mfa_setup',
  })

  res.json({
    secret: secret.base32,
    qrCodeDataUrl,
    backupCodes,
    mfaToken,
  })
})

router.post('/2fa/verify-setup', authMiddleware, async (req, res) => {
  const body = MfaVerifySetupSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }

  let mfaPayload
  try {
    mfaPayload = verifyMfaToken(body.data.mfaToken)
  } catch {
    res.status(401).json({ error: 'Invalid MFA token' })
    return
  }

  if (mfaPayload.purpose !== 'mfa_setup') {
    res.status(401).json({ error: 'Invalid MFA token' })
    return
  }

  const user = req.user
  if (!user || user.userId !== mfaPayload.userId) {
    res.status(401).json({ error: 'Invalid MFA setup session' })
    return
  }

  const record = db.select().from(users).where(eq(users.id, user.userId)).get()
  if (!record || !record.totpSecretEnc) {
    res.status(400).json({ error: '2FA setup not initiated' })
    return
  }

  if (record.totpEnabled) {
    res.status(400).json({ error: '2FA is already enabled' })
    return
  }

  const secretBase32 = decrypt(record.totpSecretEnc)
  const totp = buildTotp(record.username, secretBase32)

  if (!verifyTotpCode(totp, body.data.totpCode)) {
    res.status(401).json({ error: 'Invalid verification code' })
    return
  }

  db.update(users)
    .set({ totpEnabled: true })
    .where(eq(users.id, record.id))
    .run()

  res.json({ ok: true })
})

router.post('/2fa/disable', authMiddleware, async (req, res) => {
  const body = MfaDisableSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }

  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'Unauthenticated' })
    return
  }

  const record = db.select().from(users).where(eq(users.id, user.userId)).get()
  if (!record) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const valid = await argon2.verify(record.passwordHash, body.data.password)
  if (!valid) {
    res.status(401).json({ error: 'Invalid password' })
    return
  }

  db.update(users)
    .set({ totpSecretEnc: null, totpEnabled: false })
    .where(eq(users.id, record.id))
    .run()

  db.delete(userBackupCodes).where(eq(userBackupCodes.userId, record.id)).run()

  res.json({ ok: true })
})

export default router
