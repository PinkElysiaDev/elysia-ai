/**
 * Koishi 测试 Mock
 * 
 * 在 vitest 测试环境中，使用此 mock 替代真实的 koishi 模块，
 * 避免 Koishi 尝试启动完整的运行时环境。
 */

export class Schema {
  static object(fields: Record<string, unknown>) {
    return new Schema()
  }
  static string() {
    return new Schema()
  }
  static number() {
    return new Schema()
  }
  static boolean() {
    return new Schema()
  }
  static array(_inner: unknown) {
    return new Schema()
  }
  static dict(_inner: unknown) {
    return new Schema()
  }
  static union(_items: unknown[]) {
    return new Schema()
  }
  static intersect(_items: unknown[]) {
    return new Schema()
  }
  static const(_value: unknown) {
    return new Schema()
  }
  description(_s: string) { return this }
  default(_v: unknown) { return this }
  required() { return this }
  role(_role: string) { return this }
}

export class Context {
  logger(_name: string) {
    return {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
    }
  }
  on(_event: string, _handler: (...args: unknown[]) => unknown) {
    return () => {}
  }
}

export const App = Context
