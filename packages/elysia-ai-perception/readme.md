# koishi-plugin-elysia-ai-perception

[![npm](https://img.shields.io/npm/v/koishi-plugin-elysia-ai-perception?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-elysia-ai-perception)

> Elysia A.I. · **感知层**

对刺激做意图/实体/情感分析，输出 PerceptionResult。支持中文优先的规则分析与可选 AI 增强。

## 安装

```bash
npm i koishi-plugin-elysia-ai-perception
```

或在 Koishi 插件市场搜索 `elysia-ai-perception` 安装。安装时会自动拉取公共依赖 `@elysia-ai/core` 与 `@elysia-ai/shared`。

## 说明

- 本插件依赖运行时内核提供的服务，请确保 `koishi-plugin-elysia-ai-runtime` 已安装并启用。
- 本插件是 **Elysia A.I.** 仿生数字生命框架的一环。完整能力需配合 runtime 与其它 `koishi-plugin-elysia-ai-*` 插件协作；每个插件只负责自身的功能与配置项。
- 配置项请在 Koishi 控制台对应插件面板中设置。

## License

AGPL-3.0-or-later。若使用、修改、部署或分发本项目或衍生作品，须以相同许可条款提供对应源码。
