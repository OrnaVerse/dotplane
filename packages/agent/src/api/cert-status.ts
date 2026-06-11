import fs from 'fs/promises'
import path from 'path'
import { execa } from 'execa'
import { Router, type Request, type Response, type NextFunction } from 'express'
import { agentConfig } from '../config.js'

const router = Router()

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}

export interface CertStatusEntry {
  path: string
  subject: string | null
  issuer: string | null
  notBefore: string | null
  notAfter: string | null
  daysRemaining: number | null
  expired: boolean
}

async function findCertFiles(dir: string): Promise<string[]> {
  const results: string[] = []

  async function walk(current: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }
      if (/\.(crt|pem|cer)$/i.test(entry.name)) {
        results.push(fullPath)
      }
    }
  }

  await walk(dir)
  return results
}

async function inspectCert(certPath: string): Promise<CertStatusEntry> {
  try {
    const { stdout } = await execa('openssl', [
      'x509',
      '-in',
      certPath,
      '-noout',
      '-subject',
      '-issuer',
      '-startdate',
      '-enddate',
    ])

    const subject = stdout.match(/^subject=(.*)$/m)?.[1] ?? null
    const issuer = stdout.match(/^issuer=(.*)$/m)?.[1] ?? null
    const notBeforeRaw = stdout.match(/^notBefore=(.*)$/m)?.[1] ?? null
    const notAfterRaw = stdout.match(/^notAfter=(.*)$/m)?.[1] ?? null

    const notBefore = notBeforeRaw ? new Date(notBeforeRaw).toISOString() : null
    const notAfter = notAfterRaw ? new Date(notAfterRaw).toISOString() : null
    const daysRemaining = notAfterRaw
      ? Math.floor((new Date(notAfterRaw).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null

    return {
      path: certPath,
      subject,
      issuer,
      notBefore,
      notAfter,
      daysRemaining,
      expired: daysRemaining != null ? daysRemaining < 0 : false,
    }
  } catch {
    return {
      path: certPath,
      subject: null,
      issuer: null,
      notBefore: null,
      notAfter: null,
      daysRemaining: null,
      expired: false,
    }
  }
}

router.get('/', asyncHandler(async (_req, res) => {
  const certPaths = (
    await Promise.all(agentConfig.certCheckPaths.map((dir) => findCertFiles(dir)))
  ).flat()

  const uniquePaths = [...new Set(certPaths)]
  const certs = await Promise.all(uniquePaths.map((certPath) => inspectCert(certPath)))

  res.json({
    checkedAt: new Date().toISOString(),
    certs,
    expiringSoon: certs.filter((cert) => cert.daysRemaining != null && cert.daysRemaining <= 30),
  })
}))

export default router
