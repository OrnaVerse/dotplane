import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { requireEnv } from '../config.js'

export type UserRole = 'superadmin' | 'manager' | 'viewer'

export interface JWTPayload {
  userId: number
  username: string
  role: UserRole
  sessionId: string
  instanceScope: string[] | 'all'
}

export interface MfaTokenPayload {
  userId: number
  username: string
  purpose: 'mfa_challenge' | 'mfa_setup'
}

export function signAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, requireEnv('JWT_SECRET'), {
    expiresIn: '15m',
    algorithm: 'HS256',
  })
}

export function signRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex')
}

export function signMfaToken(payload: MfaTokenPayload): string {
  return jwt.sign(payload, requireEnv('JWT_SECRET'), {
    expiresIn: '5m',
    algorithm: 'HS256',
  })
}

export function verifyAccessToken(token: string): JWTPayload {
  return jwt.verify(token, requireEnv('JWT_SECRET')) as JWTPayload
}

export function verifyMfaToken(token: string): MfaTokenPayload {
  return jwt.verify(token, requireEnv('JWT_SECRET')) as MfaTokenPayload
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
