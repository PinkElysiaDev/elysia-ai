const { readdirSync } = require('node:fs')
const { join, relative } = require('node:path')

const generatedExtensions = new Set(['.d.ts', '.js', '.map'])
const allow = new Set([])
const violations = []

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(path)
      continue
    }

    const normalized = relative(process.cwd(), path).replace(/\\/g, '/')
    if (!normalized.includes('/src/')) continue
    if (allow.has(normalized)) continue

    if (
      normalized.endsWith('.d.ts') ||
      normalized.endsWith('.js') ||
      normalized.endsWith('.js.map') ||
      normalized.endsWith('.d.ts.map')
    ) {
      violations.push(normalized)
    }
  }
}

walk(join(process.cwd(), 'packages'))

if (violations.length) {
  console.error('Generated build artifacts found under packages/**/src:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Source hygiene check passed.')
