# koishi-plugin-elysia-ai-runtime

[![npm](https://img.shields.io/npm/v/koishi-plugin-elysia-ai-runtime?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-elysia-ai-runtime)

> Elysia A.I. · **运行时内核**

提供生命周期、事件总线、life 实例加载与各仓储挂载点。所有其它 Elysia A.I. 插件的依赖基座。

## 安装

```bash
npm i koishi-plugin-elysia-ai-runtime
```

或在 Koishi 插件市场搜索 `elysia-ai-runtime` 安装。安装时会自动拉取公共依赖 `@elysia-ai/core` 与 `@elysia-ai/shared`。

## 说明

- 本插件依赖运行时内核提供的服务，请确保 `koishi-plugin-elysia-ai-runtime` 已安装并启用。
- 本插件是 **Elysia A.I.** 仿生数字生命框架的一环。完整能力需配合 runtime 与其它 `koishi-plugin-elysia-ai-*` 插件协作；每个插件只负责自身的功能与配置项。
- 配置项请在 Koishi 控制台对应插件面板中设置。

## License

AGPL-3.0-or-later。若使用、修改、部署或分发本项目或衍生作品，须以相同许可条款提供对应源码。
