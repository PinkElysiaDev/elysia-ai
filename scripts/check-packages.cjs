const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function listPackageDirs() {
  const packageDirs = []
  for (const dirent of fs.readdirSync('packages/@elysia-ai', { withFileTypes: true })) {
    if (dirent.isDirectory()) packageDirs.push(path.join('packages/@elysia-ai', dirent.name))
  }
  for (const dirent of fs.readdirSync('packages', { withFileTypes: true })) {
    if (dirent.isDirectory() && dirent.name.startsWith('elysia-ai-')) {
      packageDirs.push(path.join('packages', dirent.name))
    }
  }
  return packageDirs
}

function resolveTypeScriptCli() {
  const candidates = [
    path.resolve('node_modules/typescript/bin/tsc'),
    path.resolve('../../node_modules/typescript/bin/tsc'),
  ]
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) throw new Error('Unable to find TypeScript CLI in local or Koishi root node_modules.')
  return found
}

function runTscBuild(tscCli, packageDirs) {
  const args = [tscCli, '-b', '--force', ...packageDirs, '--pretty', 'false']
  console.log(`node ${args.join(' ')}`)
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', shell: false })
  if (result.error) {
    console.error(result.error)
    return 1
  }
  return result.status ?? 1
}

const tscCli = resolveTypeScriptCli()
const packageDirs = listPackageDirs()
const chunkSize = 6
for (let index = 0; index < packageDirs.length; index += chunkSize) {
  const status = runTscBuild(tscCli, packageDirs.slice(index, index + chunkSize))
  if (status !== 0) process.exit(status)
}
