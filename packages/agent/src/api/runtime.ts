import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import * as runtime from '../services/runtime.service.js'

const router: Router = Router()

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}

const InstallSchema = z.object({
  runtime: z.enum(['dotnet', 'node']),
  version: z.string().min(1),
})

router.get('/', asyncHandler(async (_req, res) => {
  const runtimes = await runtime.listRuntimes()
  res.json(runtimes)
}))

router.post('/install', asyncHandler(async (req, res) => {
  const { runtime: appRuntime, version } = InstallSchema.parse(req.body)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')

  try {
    await runtime.installRuntime(appRuntime, version)
    res.write(`data: ${JSON.stringify({ done: true, runtime: appRuntime, version })}\n\n`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`)
  }
  res.end()
}))

export default router
