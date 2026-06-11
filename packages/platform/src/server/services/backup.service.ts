import fs from 'fs/promises'
import path from 'path'
import { backupDatabase } from '../db/index.js'
import { logger } from '../logger.js'

const BACKUP_DIR = process.env.BACKUP_DIR ?? './data/backups'
const RETENTION_COUNT = 30

export async function createBackup(): Promise<string> {
  await fs.mkdir(BACKUP_DIR, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const destPath = path.join(BACKUP_DIR, `dotplane-${timestamp}.db`)

  await backupDatabase(destPath)

  logger.info({ destPath }, 'Database backup created')
  await pruneOldBackups()
  return destPath
}

async function pruneOldBackups(): Promise<void> {
  const entries = await fs.readdir(BACKUP_DIR)
  const backups = entries
    .filter((f) => f.startsWith('dotplane-') && f.endsWith('.db'))
    .sort()
    .reverse()

  if (backups.length <= RETENTION_COUNT) return

  const toDelete = backups.slice(RETENTION_COUNT)
  await Promise.all(
    toDelete.map(async (file) => {
      await fs.unlink(path.join(BACKUP_DIR, file))
      logger.debug({ file }, 'Pruned old backup')
    }),
  )
}

export async function listBackups(): Promise<string[]> {
  await fs.mkdir(BACKUP_DIR, { recursive: true })
  const entries = await fs.readdir(BACKUP_DIR)
  return entries
    .filter((f) => f.startsWith('dotplane-') && f.endsWith('.db'))
    .sort()
    .reverse()
}
