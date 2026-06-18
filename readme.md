# koishi-plugin-elysia-ai

[![npm](https://img.shields.io/npm/v/koishi-plugin-elysia-ai?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-elysia-ai)

An AI agent framework designed under the bionic-inspired concept.

## Building

This monorepo builds its packages with `turbo run build`, which runs each
package's `build` script (`tsc --emitDeclarationOnly` + `esbuild` →
`lib/index.cjs` + `lib/index.mjs` for the `koishi-plugin-elysia-ai-*` plugins,
and a CJS+ESM dual build for `@elysia-ai/core` / `@elysia-ai/shared`).

```bash
yarn install
yarn build          # = turbo run build
```

### When consumed inside a root Koishi instance (yakumo build)

When this monorepo is linked into an outer Koishi app that drives its build
through **yakumo** (`"build": "yakumo build"`), yakumo's bundler (`dumble`)
cannot produce the plugin CJS bundles for all packages — it only treats imports
listed in `dependencies`/`peerDependencies` as external and silently skips
packages whose logic libs live in `devDependencies`. The result is
`Cannot find module '.../lib/index.cjs'` and `failed to load elysia-ai-*` at
`yarn start`.

To fix the root app so a single `yarn build` is sufficient, point its `build`
script at this monorepo's turbo build in addition to yakumo. Edit the root
`package.json`:

```json
"build": "yakumo build && yarn workspace @root/elysia-ai run build"
```

`@root/elysia-ai` is the `name` of this monorepo's root `package.json`, whose
`build` script is `turbo run build`. The turbo step overwrites yakumo's
ESM-only output with the correct `cjs`+`mjs`+`.d.ts` for every package.

> The `@elysia-ai/core` and `@elysia-ai/shared` packages ship CJS+ESM so the
> plugins' runtime `require('@elysia-ai/core'|'@elysia-ai/shared')` resolves
> without `ERR_PACKAGE_PATH_NOT_EXPORTED`. Do not remove their `require` export
> condition or CJS build step.

## License

This project is licensed under **AGPL-3.0-or-later**.

If you use, modify, deploy, or distribute this project or derivative works, you must provide the corresponding source code under the same license terms.
