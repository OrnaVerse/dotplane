import type { Request, Response } from 'express'

export function routeParam(req: Request, name: string): string {
  const value = req.params[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing route parameter: ${name}`)
  }
  return value
}

export function setupSSE(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
}

export function emitSSE(res: Response, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

export function parseIntQuery(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}
