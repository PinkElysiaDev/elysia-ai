const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const scoped = ['core','shared','memory','bond','model-gateway','brain','dialogue','behavior','perception','cognition','homeostasis','persona','observatory']
const replacements = Object.fromEntries(scoped.map((name) => [`@elysia-ai/koishi-plugin-${name}`, `@elysia-ai/${name}`]))

const includeExt = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.md'])
const skipDirs = new Set(['node_modules', 'lib', '.turbo', '.git'])

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(file)
      continue
    }
    if (!includeExt.has(path.extname(file))) continue
    let text = fs.readFileSync(file, 'utf8')
    let next = text
    for (const [from, to] of Object.entries(replacements)) {
      next = next.split(from).join(to)
    }
    if (next !== text) fs.writeFileSync(file, next)
  }
}

walk(root)

for (const name of scoped) {
  const packageJsonPath = path.join(root, 'packages', '@elysia-ai', name, 'package.json')
  if (!fs.existsSync(packageJsonPath)) continue
  const json = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  json.name = `@elysia-ai/${name}`
  delete json.koishi
  if (json.peerDependencies && Object.keys(json.peerDependencies).length === 0) delete json.peerDependencies
  if (json.dependencies) {
    for (const [from, to] of Object.entries(replacements)) {
      if (json.dependencies[from]) {
        json.dependencies[to] = json.dependencies[from]
        delete json.dependencies[from]
      }
    }
  }
  fs.writeFileSync(packageJsonPath, JSON.stringify(json, null, 2) + '\n')
}
