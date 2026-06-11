import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './index.js'
import { settings } from './schema.js'
import { eq } from 'drizzle-orm'

export function runMigrations(): void {
  migrate(db, { migrationsFolder: './drizzle' })
  seedDefaults()
}

function seedDefaults(): void {
  const defaults = [
    { key: 'github_token', value: '""', isSensitive: true },
    { key: 'deploy_batch_size', value: '3', isSensitive: false },
    { key: 'deploy_delay_seconds', value: '30', isSensitive: false },
    { key: 'health_check_timeout', value: '5', isSensitive: false },
    { key: 'max_log_lines', value: '500', isSensitive: false },
    { key: 'upload_max_mb', value: '500', isSensitive: false },
    { key: 'require_2fa_for_superadmin', value: 'false', isSensitive: false },
    { key: 'waf_mode', value: 'detect', isSensitive: false },
  ]

  for (const d of defaults) {
    const existing = db.select().from(settings).where(eq(settings.key, d.key)).get()
    if (!existing) {
      db.insert(settings).values(d).run()
    }
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  runMigrations()
  console.log('Migrations complete')
}
