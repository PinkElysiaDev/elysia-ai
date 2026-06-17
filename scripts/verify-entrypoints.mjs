const runtime = await import('../packages/elysia-ai-runtime/lib/index.mjs')
const body = await import('../packages/elysia-ai-body/lib/index.mjs')

if (!runtime || typeof runtime.apply !== 'function') {
  throw new Error('runtime ESM entry did not export apply()')
}

if (!body || typeof body.apply !== 'function') {
  throw new Error('body ESM entry did not export apply()')
}

console.log('esm load ok')
