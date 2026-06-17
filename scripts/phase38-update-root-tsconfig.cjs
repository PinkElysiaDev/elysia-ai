const fs = require('node:fs')
const path = require('node:path')
const tsconfigPath = path.resolve(process.cwd(), '..', '..', 'tsconfig.json')
let text = fs.readFileSync(tsconfigPath, 'utf8')
const scoped = ['behavior','brain','cognition','core','dialogue','homeostasis','memory','bond','model-gateway','observatory','perception','persona','shared']
const plugin = ['behavior','brain','cognition','dialogue','homeostasis','memory','bond','model-gateway','observatory','perception','persona']
for (const name of scoped) {
  const oldKey = `"@elysia-ai/koishi-plugin-${name}": [`
  const newKey = `"@elysia-ai/${name}": [`
  text = text.replace(oldKey, newKey)
}
const insertion = plugin.map((name) => `      "koishi-plugin-elysia-ai-${name}": [\n        "external/elysia-ai/packages/elysia-ai-${name}/src"\n      ],`).join('\n')
if (!text.includes('"koishi-plugin-elysia-ai-memory"')) {
  const marker = '      // If you are developing a scoped plugin,'
  text = text.replace(marker, insertion + '\n\n' + marker)
}
fs.writeFileSync(tsconfigPath, text)
