import fs from 'fs/promises'
import path from 'path'
import type { Request } from 'express'
import multer from 'multer'
import { v4 as uuid } from 'uuid'

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])

const UPLOADS_DIR = process.env.ARTIFACTS_PATH ?? './data/artifacts'
const ALLOWED_EXTENSIONS = new Set(['.zip'])
const ALLOWED_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
])

function ensureUploadDir(): string {
  return UPLOADS_DIR
}

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename)
  const ext = path.extname(base).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error('Only .zip files are allowed')
  }
  return `${uuid()}${ext}`
}

function assertSafeStoredFilename(filename: string): void {
  const resolved = path.resolve(ensureUploadDir(), filename)
  const root = path.resolve(ensureUploadDir())
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error('Invalid artifact filename')
  }
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const dir = ensureUploadDir()
    fs.mkdir(dir, { recursive: true })
      .then(() => cb(null, dir))
      .catch((err: Error) => cb(err, dir))
  },
  filename(_req, file, cb) {
    try {
      cb(null, sanitizeFilename(file.originalname))
    } catch (err) {
      cb(err as Error, '')
    }
  },
})

function zipFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback): void {
  const ext = path.extname(file.originalname).toLowerCase()
  const isZip = ALLOWED_MIME_TYPES.has(file.mimetype) && ALLOWED_EXTENSIONS.has(ext)
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
  assertSafeStoredFilename(filename)
  return path.join(ensureUploadDir(), path.basename(filename))
}

export async function assertZipArtifact(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, 'r')
  try {
    const header = Buffer.alloc(4)
    await handle.read(header, 0, 4, 0)
    if (!header.equals(ZIP_MAGIC)) {
      throw new Error('Uploaded file is not a valid ZIP archive')
    }
  } finally {
    await handle.close()
  }
}

export async function moveUploadedArtifact(filename: string, appId: string, version: string): Promise<string> {
  const source = getArtifactPath(filename)
  await assertZipArtifact(source)

  const safeAppId = path.basename(appId)
  const safeVersion = path.basename(version).replace(/[^a-zA-Z0-9._-]/g, '_')
  const appDir = path.join(ensureUploadDir(), safeAppId)
  await fs.mkdir(appDir, { recursive: true })
  const dest = path.join(appDir, `${safeVersion}.zip`)
  await fs.rename(source, dest)
  return dest
}
