import type { JWTPayload } from '../auth/tokens.js'

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload
      deployTokenId?: number
      agentInstall?: {
        serverId: string
        token: string
        payload: {
          token: string
          totalMemory?: number
          totalCpu?: number
          diskTotal?: number
          diskUsed?: number
          osInfo?: Record<string, string>
        }
      }
    }
  }
}

export {}
