const { readdirSync, existsSync } = require('node:fs')
const { join, relative, basename } = require('node:path')

const violations = []

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(path, visit)
      continue
    }
    visit(path)
  }
}

/** 生成产物扩展名 → 还原出源文件 stem（candidates.js / brain.d.ts → candidates / brain）。 */
function stemOf(fileName) {
  if (fileName.endsWith('.d.ts.map')) return fileName.slice(0, -'.d.ts.map'.length)
  if (fileName.endsWith('.js.map')) return fileName.slice(0, -'.js.map'.length)
  if (fileName.endsWith('.d.ts')) return fileName.slice(0, -'.d.ts'.length)
  if (fileName.endsWith('.js')) return fileName.slice(0, -'.js'.length)
  return undefined
}

walk(join(process.cwd(), 'packages'), (path) => {
  const normalized = relative(process.cwd(), path).replace(/\\/g, '/')
  if (!normalized.includes('/src/') && !normalized.includes('/lib/')) return

  if (normalized.includes('/src/')) {
    // src/ 下不允许出现任何生成产物（编译输出/声明文件）。
    if (
      normalized.endsWith('.d.ts') ||
      normalized.endsWith('.js') ||
      normalized.endsWith('.js.map') ||
      normalized.endsWith('.d.ts.map')
    ) {
      violations.push(`generated artifact under src: ${normalized}`)
    }
    return
  }

  // lib/ 是合法构建输出目录，但源文件删除后遗留的产物必须清理：
  // packages/<pkg>/lib/<rel>/<stem>.{js,d.ts,...} 要求存在对应的
  // packages/<pkg>/src/<rel>/<stem>.ts（或 .tsx）。
  const stem = stemOf(basename(normalized))
  if (stem === undefined) return // index.cjs（esbuild bundle）等非 tsc 产物跳过
  const segments = normalized.split('/')
  const libIndex = segments.indexOf('lib')
  const sourceRelative = [
    ...segments.slice(0, libIndex),   // packages/<pkg>
    'src',
    ...segments.slice(libIndex + 1, -1), // lib 内子目录
    `${stem}.ts`,
  ].join('/')
  const sourceTsxRelative = sourceRelative.slice(0, -'.ts'.length) + '.tsx'
  if (!existsSync(join(process.cwd(), sourceRelative)) && !existsSync(join(process.cwd(), sourceTsxRelative))) {
    violations.push(`stale build artifact (no matching source): ${normalized}`)
  }
})

if (violations.length) {
  console.error('Source hygiene check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Source hygiene check passed.')
