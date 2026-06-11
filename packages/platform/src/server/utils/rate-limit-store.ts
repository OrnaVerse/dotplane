import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { rateLimitStore } from '../db/schema.js'

export class SqliteRateLimitStore implements Store {
  windowMs!: number

  constructor(private readonly keyPrefix: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const fullKey = `${this.keyPrefix}${key}`
    const now = Date.now()
    const resetTime = new Date(now + this.windowMs)

    const result = db.transaction((tx) => {
      const existing = tx
        .select()
        .from(rateLimitStore)
        .where(eq(rateLimitStore.key, fullKey))
        .get()

      if (!existing || new Date(existing.resetAt).getTime() <= now) {
        tx.insert(rateLimitStore)
          .values({
            key: fullKey,
            hits: 1,
            resetAt: resetTime.toISOString(),
          })
          .onConflictDoUpdate({
            target: rateLimitStore.key,
            set: {
              hits: 1,
              resetAt: resetTime.toISOString(),
            },
          })
          .run()

        return { totalHits: 1, resetTime }
      }

      const newHits = existing.hits + 1
      tx.update(rateLimitStore)
        .set({ hits: newHits })
        .where(eq(rateLimitStore.key, fullKey))
        .run()

      return { totalHits: newHits, resetTime: new Date(existing.resetAt) }
    })

    return result
  }

  async decrement(key: string): Promise<void> {
    const fullKey = `${this.keyPrefix}${key}`

    db.transaction((tx) => {
      const existing = tx
        .select()
        .from(rateLimitStore)
        .where(eq(rateLimitStore.key, fullKey))
        .get()

      if (!existing || existing.hits <= 0) return

      tx.update(rateLimitStore)
        .set({ hits: existing.hits - 1 })
        .where(eq(rateLimitStore.key, fullKey))
        .run()
    })
  }

  async resetKey(key: string): Promise<void> {
    const fullKey = `${this.keyPrefix}${key}`

    db.delete(rateLimitStore).where(eq(rateLimitStore.key, fullKey)).run()
  }
}
