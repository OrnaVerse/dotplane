import type { JWTPayload } from '../auth/tokens.js'

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload
      deployTokenId?: number
    }
  }
}

export {}
