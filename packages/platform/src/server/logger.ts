import pino from 'pino'
import fs from 'fs'
import path from 'path'

const isDev = process.env.NODE_ENV !== 'production'
const errorLogPath = process.env.ERROR_LOG_PATH ?? '/var/log/dotplane/error.log'

const streams: pino.StreamEntry[] = [{ stream: process.stdout }]

if (!isDev) {
  try {
    const dir = path.dirname(errorLogPath)
    fs.mkdirSync(dir, { recursive: true })
    streams.push({ level: 'error', stream: pino.destination(errorLogPath) })
  } catch {
    // ignore on dev machines without /var/log
  }
}

export const logger = pino(
  { level: isDev ? 'debug' : 'info' },
  pino.multistream(streams)
)
