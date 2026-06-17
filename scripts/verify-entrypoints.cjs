const runtime = require('../packages/elysia-ai-runtime/lib/index.cjs')
const body = require('../packages/elysia-ai-body/lib/index.cjs')

if (!runtime || typeof runtime.apply !== 'function') {
  throw new Error('runtime CJS entry did not export apply()')
}

if (!body || typeof body.apply !== 'function') {
  throw new Error('body CJS entry did not export apply()')
}

console.log('cjs load ok')
