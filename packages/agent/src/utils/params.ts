import type { Request } from 'express'

export function requireParam(req: Request, name: string): string {
  const value = req.params[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing route parameter: ${name}`)
  }
  return value
}
