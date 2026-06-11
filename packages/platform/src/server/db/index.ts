import fs from 'fs'
import path from 'path'
import Database, { type Database as SqliteDatabase } from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

const dbPath = process.env.DB_PATH ?? './data/dotplane.db'
fs.mkdirSync(path.dirname(dbPath), { recursive: true })

const sqliteDb: SqliteDatabase = new Database(dbPath)
sqliteDb.pragma('journal_mode = WAL')
sqliteDb.pragma('foreign_keys = ON')

export const db = drizzle(sqliteDb, { schema })

type Db = BetterSQLite3Database<typeof schema>

export function withTransaction<T>(fn: (tx: Db) => T): T {
  return db.transaction((tx) => fn(tx))
}

export async function backupDatabase(destPath: string): Promise<void> {
  await sqliteDb.backup(destPath)
}
