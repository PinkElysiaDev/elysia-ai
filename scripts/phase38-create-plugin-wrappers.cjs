const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const plugins = [
  'memory','bond','model-gateway','brain','dialogue','behavior','perception','cognition','homeostasis','persona','observatory'
]

const descriptions = {
  memory: 'Elysia A.I. memory Koishi plugin.',
  bond: 'Elysia A.I. bond Koishi plugin.',
  'model-gateway': 'Elysia A.I. model gateway Koishi plugin.',
  brain: 'Elysia A.I. brain Koishi plugin.',
  dialogue: 'Elysia A.I. dialogue Koishi plugin.',
  behavior: 'Elysia A.I. behavior Koishi plugin.',
  perception: 'Elysia A.I. perception Koishi plugin.',
  cognition: 'Elysia A.I. cognition Koishi plugin.',
  homeostasis: 'Elysia A.I. homeostasis Koishi plugin.',
  persona: 'Elysia A.I. persona Koishi plugin.',
  observatory: 'Elysia A.I. observatory Koishi plugin.',
}

const serviceNames = {
  memory: 'elysia.memory',
  bond: 'elysia.bond',
  'model-gateway': 'elysia.modelGateway',
  brain: 'elysia.brain',
  dialogue: 'elysia.dialogue',
  behavior: 'elysia.behavior',
  perception: 'elysia.perception',
  cognition: 'elysia.cognition',
  homeostasis: 'elysia.homeostasis',
  persona: 'elysia.persona',
  observatory: 'elysia.observatory',
}

for (const name of plugins) {
  const dir = path.join(root, 'packages', `elysia-ai-${name}`)
  const src = path.join(dir, 'src')
  fs.mkdirSync(src, { recursive: true })

  fs.writeFileSync(path.join(src, 'index.ts'), `export * from '@elysia-ai/${name}'\n`)

  const packageJson = {
    name: `koishi-plugin-elysia-ai-${name}`,
    description: descriptions[name],
    version: '0.1.0',
    private: true,
    type: 'module',
    main: 'lib/index.js',
    types: 'lib/index.d.ts',
    exports: {
      '.': {
        types: './lib/index.d.ts',
        import: './lib/index.js',
      },
      './package.json': './package.json',
    },
    files: ['lib'],
    scripts: {
      build: 'tsc -p tsconfig.json',
    },
    dependencies: {
      [`@elysia-ai/${name}`]: 'workspace:*',
    },
    peerDependencies: {
      koishi: '^4.18.0',
    },
    devDependencies: {
      koishi: '^4.18.0',
      typescript: '^5.0.0',
    },
    koishi: {
      description: descriptions[name],
      service: {
        implements: [serviceNames[name]],
      },
    },
    license: 'AGPL-3.0-or-later',
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n')

  const tsconfig = {
    extends: '../../../../tsconfig',
    compilerOptions: {
      rootDir: 'src',
      outDir: 'lib',
      emitDeclarationOnly: false,
    },
    include: ['src'],
    references: [
      { path: `../@elysia-ai/${name}` },
    ],
  }
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n')
}
