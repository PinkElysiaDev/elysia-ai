# @elysia-ai/core

[![npm](https://img.shields.io/npm/v/@elysia-ai/core?style=flat-square)](https://www.npmjs.com/package/@elysia-ai/core)

> Elysia A.I. · **核心公共库**

Elysia A.I. 仿生数字生命框架的核心领域层：核心类型（LifeInstance / Habitat / Bond / Memory / Stimulus / Behavior / Dialogue / Persona / Homeostasis 等）、事件总线接口与默认内存实现、仓储抽象接口，以及运行时校验用的 Zod schema。

## 说明

- 本包是被各 `koishi-plugin-elysia-ai-*` 插件共享的**公共依赖**，由 npm 自动安装，通常无需手动引入。
- 不含任何 MongoDB / Redis 等具体实现，只持有抽象接口，保持依赖纯净（仅依赖 `zod`）。
- 它**不是** Koishi 插件，不会被识别或加载为插件。

## License

AGPL-3.0-or-later。
