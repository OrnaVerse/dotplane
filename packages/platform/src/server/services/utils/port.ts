import { eq, max } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { instances } from '../../db/schema.js'
import { RESERVED_PORTS, START_PORT } from '../../config.js'

export async function getNextAvailablePort(serverId: string): Promise<number> {
  const [row] = await db
    .select({ nextPort: max(instances.port) })
    .from(instances)
    .where(eq(instances.serverId, serverId))

  let port = (row?.nextPort ?? START_PORT - 1) + 1
  while (RESERVED_PORTS.has(port)) {
    port++
  }
  return port
}
