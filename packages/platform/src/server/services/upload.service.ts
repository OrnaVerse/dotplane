import fs from 'fs/promises'
import path from 'path'
import type { Request } from 'express'
import multer from 'multer'
import { v4 as uuid } from 'uuid'

const UPLOADS_DIR = process.env.ARTIFACTS_PATH ?? './data/artifacts'

function ensureUploadDir(): string {
  return UPLOADS_DIR
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const dir = ensureUploadDir()
    fs.mkdir(dir, { recursive: true })
      .then(() => cb(null, dir))
      .catch((err: Error) => cb(err, dir))
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname) || '.zip'
    cb(null, `${uuid()}${ext}`)
  },
})

function zipFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback): void {
  const allowed = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream']
  const isZip = allowed.includes(file.mimetype) || file.originalname.endsWith('.zip')
  if (isZip) {
    cb(null, true)
  } else {
    cb(new Error('Only .zip files are allowed'))
  }
}

export const uploadArtifact = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: zipFilter,
})

export function getArtifactPath(filename: string): string {
  return path.join(ensureUploadDir(), filename)
}

export async function moveUploadedArtifact(filename: string, appId: string, version: string): Promise<string> {
  const appDir = path.join(ensureUploadDir(), appId)
  await fs.mkdir(appDir, { recursive: true })
  const dest = path.join(appDir, `${version}.zip`)
  await fs.rename(getArtifactPath(filename), dest)
  return dest
}
