# koishi-plugin-elysia-ai-homeostasis

[![npm](https://img.shields.io/npm/v/koishi-plugin-elysia-ai-homeostasis?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-elysia-ai-homeostasis)

> Elysia A.I. · **内稳态**

维护能量/心情/社交/好奇心等生命状态，具备朝基线松弛的恢复动力学，仅对被路由的生命更新。

## 安装

```bash
npm i koishi-plugin-elysia-ai-homeostasis
```

或在 Koishi 插件市场搜索 `elysia-ai-homeostasis` 安装。安装时会自动拉取公共依赖 `@elysia-ai/core` 与 `@elysia-ai/shared`。

## 说明

- 本插件依赖 `koishi-plugin-elysia-ai-runtime`（运行时内核），请确保已安装并启用。
- 本插件是 **Elysia A.I.** 仿生数字生命框架的一环。完整能力需配合 runtime 与其它 `koishi-plugin-elysia-ai-*` 插件协作；每个插件只负责自身的功能与配置项。
- 配置项请在 Koishi 控制台对应插件面板中设置。

## License

AGPL-3.0-or-later。若使用、修改、部署或分发本项目或衍生作品，须以相同许可条款提供对应源码。
