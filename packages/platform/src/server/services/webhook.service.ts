import { safeFetch, validateUrl, webhookUrlOptions } from '@dotplane/shared'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { outboundWebhooks } from '../db/schema.js'
import { hmacSha256 } from '../utils/crypto.js'
import { logger } from '../logger.js'

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

export interface WebhookPayload {
  event: string
  timestamp: string
  data: Record<string, unknown>
}

export function assertSafeWebhookUrl(url: string): void {
  validateUrl(url, webhookUrlOptions())
}

export async function fireWebhooks(event: string, data: Record<string, unknown>): Promise<void> {
  const hooks = await db
    .select()
    .from(outboundWebhooks)
    .where(eq(outboundWebhooks.isActive, true))

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  }

  const body = JSON.stringify(payload)

  await Promise.all(
    hooks
      .filter((hook) => hook.events.includes(event) || hook.events.includes('*'))
      .map((hook) => deliverWebhook(hook.id, hook.url, hook.secret, event, body)),
  )
}

async function deliverWebhook(
  webhookId: number,
  url: string,
  secret: string,
  event: string,
  body: string,
): Promise<void> {
  const signature = hmacSha256(secret, body)

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await safeFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dotplane-Signature': `sha256=${signature}`,
          'X-Dotplane-Event': event,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      }, webhookUrlOptions())

      await db
        .update(outboundWebhooks)
        .set({ lastCalledAt: new Date().toISOString(), lastStatus: res.status })
        .where(eq(outboundWebhooks.id, webhookId))

      if (res.ok) return

      logger.warn({ webhookId, status: res.status, attempt }, 'Webhook delivery failed')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      logger.warn({ webhookId, attempt, err: msg }, 'Webhook delivery error')
    }

    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }

  await db
    .update(outboundWebhooks)
    .set({ lastCalledAt: new Date().toISOString(), lastStatus: 0 })
    .where(eq(outboundWebhooks.id, webhookId))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
