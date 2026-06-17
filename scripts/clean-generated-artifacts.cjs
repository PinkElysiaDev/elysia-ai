const { existsSync, readdirSync, rmSync, unlinkSync } = require('node:fs')
const { join, relative, resolve } = require('node:path')

const root = process.cwd()
const packagesRoot = resolve(root, 'packages')
const removed = []

function assertInsideRoot(path) {
  const resolved = resolve(path)
  if (!resolved.startsWith(root)) {
    throw new Error(`Refusing to remove path outside workspace: ${resolved}`)
  }
  return resolved
}

function isGeneratedSourceArtifact(path) {
  const normalized = relative(root, path).replace(/\\/g, '/')
  return normalized.includes('/src/') && (
    normalized.endsWith('.d.ts') ||
    normalized.endsWith('.d.ts.map') ||
    normalized.endsWith('.js') ||
    normalized.endsWith('.js.map')
  )
}

function walk(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '.turbo') {
        const resolved = assertInsideRoot(path)
        rmSync(resolved, { recursive: true, force: true })
        removed.push(relative(root, resolved).replace(/\\/g, '/'))
        continue
      }
      walk(path)
      continue
    }

    if (isGeneratedSourceArtifact(path)) {
      const resolved = assertInsideRoot(path)
      unlinkSync(resolved)
      removed.push(relative(root, resolved).replace(/\\/g, '/'))
    }
  }
}

walk(packagesRoot)

const rootTurbo = join(root, '.turbo')
if (existsSync(rootTurbo)) {
  const resolved = assertInsideRoot(rootTurbo)
  rmSync(resolved, { recursive: true, force: true })
  removed.push(relative(root, resolved).replace(/\\/g, '/'))
}

for (const item of removed) console.log(`removed ${item}`)
console.log(`Removed ${removed.length} generated artifact(s).`)
