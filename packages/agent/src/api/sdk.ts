import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import * as sdk from '../services/sdk.service.js'

const router = Router()

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}

const InstallSchema = z.object({
  version: z.string().min(1),
})

router.get('/installed', asyncHandler(async (_req, res) => {
  const installed = await sdk.getInstalledSdks()
  res.json(installed)
}))

router.post('/install', asyncHandler(async (req, res) => {
  const { version } = InstallSchema.parse(req.body)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')

  try {
    await sdk.installSdk(version, (line) => {
      res.write(`data: ${JSON.stringify({ line })}\n\n`)
    })
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`)
  }
  res.end()
}))

export default router
