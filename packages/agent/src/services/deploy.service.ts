import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import unzipper from 'unzipper'

export const PROTECTED_PATTERNS = [
  /^uploads\//,
  /^appsettings\..*\.json$/,
  /^appsettings\.json$/,
]

function isProtected(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\//, '')
  return PROTECTED_PATTERNS.some((pattern) => pattern.test(normalized))
}

export async function deployArtifact(params: {
  artifactUrl: string
  appPath: string
  uploadsPath: string
}): Promise<void> {
  const { artifactUrl, appPath } = params
  const tempDir = `/tmp/dotplane_deploy_${Date.now()}`
  const zipPath = `${tempDir}/artifact.zip`

  try {
    await fs.mkdir(tempDir, { recursive: true })
    await downloadFile(artifactUrl, zipPath)

    const extractDir = `${tempDir}/extracted`
    await extractZip(zipPath, extractDir)
    await copyWithProtection(extractDir, appPath)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  if (!res.body) throw new Error('No response body')

  const writeStream = createWriteStream(destPath)
  await pipeline(res.body as unknown as NodeJS.ReadableStream, writeStream)
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    fsSync.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: destDir }))
      .on('close', resolve)
      .on('error', reject)
  })
}

async function copyWithProtection(srcDir: string, destDir: string): Promise<void> {
  const entries = await getAllFiles(srcDir)

  for (const entry of entries) {
    const relativePath = path.relative(srcDir, entry)
    if (isProtected(relativePath)) continue

    const destPath = path.join(destDir, relativePath)
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    await fs.copyFile(entry, destPath)
  }
}

async function getAllFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...await getAllFiles(fullPath))
    } else {
      results.push(fullPath)
    }
  }
  return results
}
