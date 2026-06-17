# @elysia-ai/shared

[![npm](https://img.shields.io/npm/v/@elysia-ai/shared?style=flat-square)](https://www.npmjs.com/package/@elysia-ai/shared)

> Elysia A.I. · **共享工具库**

Elysia A.I. 各插件共享的工具与基类：Koishi 服务注册/查找、数值工具（`clampUnit`/`clampUnitOr`/`clampPercent`）、刺激文本提取、AI 相关性选择器基类、Mongo 文档仓储基类与 URL 连接器、插件工厂 `createElysiaPlugin`、preflight 与日志工具。

## 说明

- 本包是被各 `koishi-plugin-elysia-ai-*` 插件共享的**公共依赖**，由 npm 自动安装，通常无需手动引入。
- 依赖 `@elysia-ai/core`。`mongodb` 为可选依赖：仅当使用 MongoDB 仓储时才需在部署环境安装。
- 它**不是** Koishi 插件，不会被识别或加载为插件。

## License

AGPL-3.0-or-later。
