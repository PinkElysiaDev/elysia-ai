/**
 * Koishi 测试 Mock
 *
 * 在 vitest 测试环境中，使用此 mock 替代真实的 koishi 模块，
 * 避免 Koishi 尝试启动完整的运行时环境。
 *
 * 同时提供 cordis 服务机制的最低兼容实现（set / get）：
 * 生产代码 service-registry 通过 ctx.set()/ctx.get() 注册与读取服务，
 * 而 cordis 中属性访问与服务表本是同一视图。这里的 mock 让
 * `ctx['elysia.runtime'] = runtime` 与 `ctx.get('elysia.runtime')`
 * 读写同一张服务表，测试两种写法均可使用。
 */

export { default as Schema } from 'schemastery'

interface MockLogger {
  info(message: unknown, ...args: unknown[]): void
  error(message: unknown, ...args: unknown[]): void
  warn(message: unknown, ...args: unknown[]): void
  debug(message: unknown, ...args: unknown[]): void
}

function noop(): void {}

function createMockLogger(): MockLogger {
  return { info: noop, error: noop, warn: noop, debug: noop }
}

interface CordisView {
  get(name: string): unknown
  set(name: string, value: unknown): void
}

function createCordisView(base: object, services: Map<string, unknown>): CordisView {
  const record = base as Record<string, unknown>
  return {
    get(name: string): unknown {
      if (services.has(name)) return services.get(name)
      return Object.prototype.hasOwnProperty.call(record, name) ? record[name] : undefined
    },
    set(name: string, value: unknown): void {
      if (value === undefined) {
        services.delete(name)
        if (Object.prototype.hasOwnProperty.call(record, name)) record[name] = undefined
      } else {
        services.set(name, value)
        // 对象字面量里预置的服务名保持同步，避免属性视图读到旧值
        if (Object.prototype.hasOwnProperty.call(record, name)) record[name] = value
      }
    },
  }
}

function proxify<T extends object>(base: T, view: CordisView): T {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !(prop in target)) {
        if (prop === 'get' || prop === 'set') {
          return view[prop]
        }
        return view.get(prop)
      }
      return Reflect.get(target, prop, receiver)
    },
    set(target, prop, value, receiver) {
      if (typeof prop === 'string' && !(prop in target)) {
        view.set(prop, value)
        return true
      }
      return Reflect.set(target, prop, value, receiver)
    },
    has(target, prop) {
      if (typeof prop === 'string' && !(prop in target) && view.get(prop) !== undefined) {
        return true
      }
      return Reflect.has(target, prop)
    },
  })
}

export class Context {
  private view: CordisView
  private handlers: Array<(...args: unknown[]) => unknown> = []

  constructor() {
    this.view = createCordisView(this, new Map())
    // 构造函数返回 Proxy，使属性赋值与 cordis 访问器共享服务表
    return proxify(this, this.view)
  }

  logger(_name: string): MockLogger {
    return createMockLogger()
  }

  on(_event: string, handler: (...args: unknown[]) => unknown): () => void {
    this.handlers.push(handler)
    return () => {
      const index = this.handlers.indexOf(handler)
      if (index >= 0) this.handlers.splice(index, 1)
    }
  }
}

export const App = Context

/**
 * 给测试手写的 fake context 补齐 cordis 服务机制：
 * 包装后 `ctx['elysia.runtime'] = runtime` 与 `ctx.get('elysia.runtime')`
 * 视图一致，属性赋值注册的服务可被生产代码的 ctx.get() 读取。
 */
export function asCordisContext<T extends object>(base: T): T {
  return proxify(base, createCordisView(base, new Map()))
}
